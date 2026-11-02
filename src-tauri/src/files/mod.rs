use crate::{
    adb::{
        process::{cancellation, check_cancel, Cancel},
        Adb,
    },
    models::*,
    parsing::*,
};
use std::{fs, path::Path};
use uuid::Uuid;
const LIST_SCRIPT: &str = r#"[ -d "$1" ] && [ -r "$1" ] && [ -x "$1" ] || { echo "目录不存在或无访问权限" >&2; exit 1; }; cd "$1" || exit 1; printf "ATF1\000"; for p in ./* ./.[!.]* ./..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; m=$(stat -c "%f %s %Y" "$p") || exit 1; printf "%s\000%s\000" "$m" "${p#./}"; done; printf "END\000""#;
const NO_CLOBBER: &str =
    r#"[ ! -e "$1" ] && [ ! -L "$1" ] || { echo "同名文件已存在，请更换文件名" >&2; exit 1; }"#;

/// 按业务提供 ADB 操作；调用方显式引入能力，底层客户端不反向依赖业务。
pub(crate) trait FileOperations {
    fn list_files(&self, device: &Target, directory: &str) -> Result<Vec<DeviceFile>>;
    fn mkdir(&self, device: &Target, directory: &str, name: &str) -> Result<()>;
    fn upload(&self, device: &Target, local: &Path, directory: &str) -> Result<()>;
    fn rename_file(&self, device: &Target, directory: &str, name: &str, next: &str) -> Result<()>;
    fn delete_file(
        &self,
        device: &Target,
        directory: &str,
        name: &str,
        consent: bool,
    ) -> Result<()>;
    fn download(&self, device: &Target, remote: &str, local: &Path) -> Result<()>;
}
impl FileOperations for Adb {
    fn list_files(&self, device: &Target, directory: &str) -> Result<Vec<DeviceFile>> {
        let directory = remote_path(directory)?;
        self.ensure_online(device)?;
        parse_files(
            &directory,
            &self.script(device, LIST_SCRIPT, &[&directory])?,
        )
    }
    fn mkdir(&self, device: &Target, directory: &str, name: &str) -> Result<()> {
        if name.len() > 255 || name.chars().any(|c| c.is_control()) {
            return Err("文件夹名称不能包含控制字符，且不能超过 255 字节。".into());
        }
        let path = child_path(directory, name)?;
        self.ensure_online(device)?;
        self.shell(device, &["mkdir", &path])?;
        Ok(())
    }
    /// 上传文件或目录：local 为原生选择器授予的路径，directory 为设备目录。
    /// 目录先复制成不含链接的本地快照；远端暂存成功后无覆盖提交，失败仅清理本次暂存项。
    fn upload(&self, device: &Target, local: &Path, directory: &str) -> Result<()> {
        let metadata = fs::symlink_metadata(local).map_err(|e| e.to_string())?;
        if is_link(&metadata) || (!metadata.is_file() && !metadata.is_dir()) {
            return Err("请选择普通文件或文件夹，不支持链接与特殊文件。".into());
        }
        let destination = child_path(
            directory,
            local
                .file_name()
                .and_then(|n| n.to_str())
                .ok_or("文件名无效")?,
        )?;
        let temporary = child_path(
            directory,
            &format!(".android-tool-upload-{}", Uuid::new_v4()),
        )?;
        self.ensure_online(device)?;
        self.script(device, NO_CLOBBER, &[&destination])?;
        // 快照避免 ADB 遍历本地链接；空目录、隐藏文件及原有目录层级一并保留。
        let snapshot = tempfile::tempdir().map_err(|e| e.to_string())?;
        let source = if metadata.is_dir() {
            let root = snapshot.path().join("content");
            copy_upload_tree(local, &root, &self.cancel, 0, &mut 0)?;
            root
        } else {
            local.to_path_buf()
        };
        let result = (|| {
            check_cancel(&self.cancel)?;
            let mut args = self.target(device)?;
            args.extend([
                "push".into(),
                source.to_string_lossy().into_owned(),
                temporary.clone(),
            ]);
            self.cmd(args, 1800000, None)?;
            if metadata.is_dir() {
                // ADB push 会忽略空目录；从独占快照补齐空叶目录，mkdir -p 同时补齐其父级。
                // 经 stdin 发送脚本，避免 Windows 命令行长度限制；每条路径仍按远端 shell 转义。
                let mut stack = vec![(source.clone(), temporary.clone())];
                let mut script = String::from("set -e\n");
                while let Some((local_dir, remote_dir)) = stack.pop() {
                    check_cancel(&self.cancel)?;
                    let entries = fs::read_dir(local_dir)
                        .map_err(|e| e.to_string())?
                        .collect::<std::io::Result<Vec<_>>>()
                        .map_err(|e| e.to_string())?;
                    if entries.is_empty() {
                        script.push_str(&format!("mkdir -p {}\n", shell_arg(&remote_dir)));
                    }
                    for entry in entries {
                        if entry.file_type().map_err(|e| e.to_string())?.is_dir() {
                            let name = entry.file_name();
                            let name = name.to_str().ok_or("文件名无效")?;
                            stack.push((entry.path(), child_path(&remote_dir, name)?));
                        }
                    }
                }
                let mut args = self.target(device)?;
                args.extend(["shell".into(), "sh".into(), "-s".into()]);
                self.cmd(args, 120000, Some(&script))?;
            }
            self.script(device,r#"[ ! -e "$2" ] && [ ! -L "$2" ] || { echo "同名文件已存在" >&2; exit 1; }; mv -n "$1" "$2" || exit 1; [ ! -e "$1" ] && [ -e "$2" ] && [ ! -L "$2" ]"#,&[&temporary,&destination])?;
            Ok(())
        })();
        let mut cleanup = self.target(device)?;
        cleanup.extend([
            "shell".into(),
            "rm".into(),
            "-rf".into(),
            shell_arg(&temporary),
        ]);
        let _ = self
            .runner
            .run(&self.executable, &cleanup, &cancellation(), 3000, None);
        result
    }
    /// 重命名当前目录中的普通项，禁止覆盖目标名称；设备重连后必须重新选择。
    fn rename_file(&self, device: &Target, directory: &str, name: &str, next: &str) -> Result<()> {
        let source = mutable_child_path(directory, name)?;
        let destination = mutable_child_path(directory, next)?;
        self.ensure_online(device)?;
        if source == destination {
            return Ok(());
        }
        self.script(device, r#"[ ! -L "$1" ] && { [ -f "$1" ] || [ -d "$1" ]; } || { echo "文件已变化或不支持此类型" >&2; exit 1; }; [ ! -e "$2" ] && [ ! -L "$2" ] || { echo "同名文件已存在" >&2; exit 1; }; mv -n "$1" "$2" || exit 1; [ ! -e "$1" ] && [ -e "$2" ]"#, &[&source, &destination])?;
        Ok(())
    }
    /// 删除已确认的单个文件或文件夹；路径由目录和单层名称构造，禁止存储根目录及链接。
    fn delete_file(
        &self,
        device: &Target,
        directory: &str,
        name: &str,
        consent: bool,
    ) -> Result<()> {
        if !consent {
            return Err("请先确认删除操作。".into());
        }
        let path = mutable_child_path(directory, name)?;
        self.ensure_online(device)?;
        self.script(device, r#"[ ! -L "$1" ] && { [ -f "$1" ] || [ -d "$1" ]; } || { echo "文件已变化或不支持此类型" >&2; exit 1; }; rm -r "$1" || exit 1; [ ! -e "$1" ] && [ ! -L "$1" ]"#, &[&path])?;
        Ok(())
    }
    /// 下载到同目录独占文件，成功后原子替换；取消或失败保留原目标内容。
    fn download(&self, device: &Target, remote: &str, local: &Path) -> Result<()> {
        let remote = remote_path(remote)?;
        self.ensure_online(device)?;
        self.script(
            device,
            r#"[ -f "$1" ] && [ ! -L "$1" ] || { echo "仅支持下载普通文件" >&2; exit 1; }"#,
            &[&remote],
        )?;
        let temporary = tempfile::NamedTempFile::new_in(local.parent().ok_or("下载路径无效")?)
            .map_err(|e| e.to_string())?;
        let mut args = self.target(device)?;
        args.extend([
            "pull".into(),
            remote,
            temporary.path().to_string_lossy().into_owned(),
        ]);
        self.cmd(args, 1800000, None)?;
        check_cancel(&self.cancel)?;
        temporary
            .persist(local)
            .map_err(|e| format!("无法保存下载文件：{e}"))?;
        Ok(())
    }
}
fn is_link(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        // Windows junction/reparse point 同样不能在目录上传时跟随。
        if metadata.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    metadata.file_type().is_symlink()
}

/// 将 source 复制到本次独占的 destination，保留层级并拒绝链接、特殊文件及异常深目录。
/// cancel 支持中断；depth/count 控制遍历上限，返回复制结果或可展示错误。
pub(crate) fn copy_upload_tree(
    source: &Path,
    destination: &Path,
    cancel: &Cancel,
    depth: usize,
    count: &mut usize,
) -> Result<()> {
    check_cancel(cancel)?;
    *count += 1;
    if depth > 64 || *count > 100_000 {
        return Err("目录层级或文件数量过多，请分批上传。".into());
    }
    let metadata = fs::symlink_metadata(source).map_err(|e| e.to_string())?;
    if is_link(&metadata) {
        return Err(format!("文件夹内含链接，无法上传：{}", source.display()));
    }
    if metadata.is_dir() {
        fs::create_dir(destination).map_err(|e| e.to_string())?;
        for entry in fs::read_dir(source).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name();
            let name = name.to_str().ok_or("文件名不是有效 UTF-8，无法上传。")?;
            child_path("/", name)?;
            copy_upload_tree(
                &entry.path(),
                &destination.join(name),
                cancel,
                depth + 1,
                count,
            )?;
        }
    } else if metadata.is_file() {
        fs::copy(source, destination).map_err(|e| e.to_string())?;
    } else {
        return Err(format!(
            "文件夹内含特殊文件，无法上传：{}",
            source.display()
        ));
    }
    Ok(())
}
