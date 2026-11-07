//! 登记 ADM 启动的客户端；正常退出时先停止接收新进程，再终止并回收已有客户端。
use std::{
    collections::HashMap,
    io,
    process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, ExitStatus},
    sync::{Arc, Mutex, OnceLock, Weak},
    thread,
    time::{Duration, Instant},
};

#[derive(Default)]
struct State {
    closing: bool,
    updating: bool,
    children: HashMap<u32, Weak<Mutex<Child>>>,
}
#[derive(Default)]
pub struct Registry(Mutex<State>);
static REGISTRY: OnceLock<Arc<Registry>> = OnceLock::new();

pub struct Client {
    child: Arc<Mutex<Child>>,
    registry: Arc<Registry>,
    id: u32,
}
impl Registry {
    /// 原子登记新客户端，避免退出检查与 spawn 之间漏掉刚创建的进程。
    fn spawn(self: &Arc<Self>, command: &mut Command) -> io::Result<Client> {
        let mut state = self.0.lock().unwrap();
        if state.closing || state.updating {
            return Err(io::Error::other("ADM 正在退出，不能启动新任务。"));
        }
        let child = command.spawn()?;
        let id = child.id();
        trace("started", id);
        let child = Arc::new(Mutex::new(child));
        state.children.insert(id, Arc::downgrade(&child));
        Ok(Client {
            child,
            registry: self.clone(),
            id,
        })
    }
    /// 只处理本实例登记的直接子进程；最多等待 timeout，不调用 adb kill-server 或按名称杀进程。
    fn stop(&self, timeout: Duration, for_update: bool) -> usize {
        let children: Vec<_> = {
            let mut state = self.0.lock().unwrap();
            if for_update {
                state.updating = true;
            } else {
                state.closing = true;
            }
            state.children.values().filter_map(Weak::upgrade).collect()
        };
        for child in &children {
            let _ = child.lock().unwrap().kill();
        }
        let deadline = Instant::now() + timeout;
        loop {
            let remaining = children
                .iter()
                .filter(|child| !matches!(child.lock().unwrap().try_wait(), Ok(Some(_))))
                .count();
            if remaining == 0 || Instant::now() >= deadline {
                return remaining;
            }
            thread::sleep(Duration::from_millis(10));
        }
    }
}
impl Client {
    pub fn stdin(&self) -> Option<ChildStdin> {
        self.child.lock().unwrap().stdin.take()
    }
    pub fn stdout(&self) -> Option<ChildStdout> {
        self.child.lock().unwrap().stdout.take()
    }
    pub fn stderr(&self) -> Option<ChildStderr> {
        self.child.lock().unwrap().stderr.take()
    }
    pub fn kill(&self) -> io::Result<()> {
        self.child.lock().unwrap().kill()
    }
    pub fn wait(&self) -> io::Result<ExitStatus> {
        self.child.lock().unwrap().wait()
    }
    pub fn try_wait(&self) -> io::Result<Option<ExitStatus>> {
        self.child.lock().unwrap().try_wait()
    }
}
impl Drop for Client {
    fn drop(&mut self) {
        // 包括读管道失败、任务提前返回等路径；PID 被系统复用时不能移除另一个新客户端。
        let mut child = self.child.lock().unwrap();
        if !matches!(child.try_wait(), Ok(Some(_))) {
            let _ = child.kill();
            let _ = child.wait();
        }
        drop(child);
        trace("reaped", self.id);
        let mut state = self.registry.0.lock().unwrap();
        if state
            .children
            .get(&self.id)
            .is_some_and(|value| value.ptr_eq(&Arc::downgrade(&self.child)))
        {
            state.children.remove(&self.id);
        }
    }
}
fn trace(event: &str, id: u32) {
    // 排查生命周期时按需记录 PID，不默认输出命令参数或设备信息。
    if std::env::var_os("ADM_PROCESS_TRACE").as_deref() == Some(std::ffi::OsStr::new("1")) {
        eprintln!("ADM client {event}: {id}");
    }
}
pub fn spawn(command: &mut Command) -> io::Result<Client> {
    REGISTRY
        .get_or_init(|| Arc::new(Registry::default()))
        .spawn(command)
}
pub fn shutdown() {
    {
        let registry = REGISTRY.get_or_init(|| Arc::new(Registry::default()));
        let remaining = registry.stop(Duration::from_secs(3), false);
        if remaining != 0 {
            eprintln!("ADM 退出时仍有 {remaining} 个客户端未确认结束");
        }
    }
}

// NSIS 成功接管后直接退出，不会触发普通 Exit。若启动安装器失败，允许重新使用 ADB。
#[cfg(windows)]
pub(crate) fn suspend_for_update() {
    REGISTRY
        .get_or_init(|| Arc::new(Registry::default()))
        .stop(Duration::from_secs(3), true);
}
#[cfg(windows)]
pub(crate) fn resume_after_failed_update() {
    if let Some(registry) = REGISTRY.get() {
        // 不解开真正退出时设置的 closing 标志。
        registry.0.lock().unwrap().updating = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sleeper() -> Command {
        #[cfg(unix)]
        let command = {
            let mut c = Command::new("/bin/sleep");
            c.arg("30");
            c
        };
        #[cfg(windows)]
        let command = {
            let mut c = Command::new("ping.exe");
            c.args(["-n", "30", "127.0.0.1"]);
            c
        };
        command
    }
    #[test]
    fn shutdown_reaps_owned_clients_rejects_new_work_and_preserves_other_clients() {
        let registry = Arc::new(Registry::default());
        let other = Arc::new(Registry::default());
        let owned = registry.spawn(&mut sleeper()).unwrap();
        let unrelated = other.spawn(&mut sleeper()).unwrap();
        assert_eq!(registry.stop(Duration::from_secs(2), false), 0);
        assert!(owned.try_wait().unwrap().is_some());
        assert!(registry.spawn(&mut sleeper()).is_err());
        assert!(unrelated.try_wait().unwrap().is_none());
        assert_eq!(registry.stop(Duration::from_secs(2), false), 0);
    }
    #[test]
    fn dropped_client_is_reaped_even_when_task_returns_early() {
        let registry = Arc::new(Registry::default());
        let client = registry.spawn(&mut sleeper()).unwrap();
        let handle = client.child.clone();
        drop(client);
        assert!(handle.lock().unwrap().try_wait().unwrap().is_some());
        assert!(registry.0.lock().unwrap().children.is_empty());
    }
}
