"""离线验证发布汇总及失败恢复，不访问或修改真实 GitHub Release。"""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from scripts import release_ci as release

TAG = "v0.1.0-build.1"
COMMIT = "a" * 40
REPOSITORY = "example/adm"
URL = f"https://github.com/{REPOSITORY}/releases/tag/{TAG}"


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="adm-release-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.downloads = self.root / "downloads"
        self.output = self.root / "publish"
        (self.root / "legal").mkdir()
        (self.root / "legal/manifest.json").write_text("{}", encoding="utf-8")
        (self.root / "legal/release-review.json").write_text('{"status":"ready"}', encoding="utf-8")
        (self.root / "package.json").write_text(json.dumps({
            "version": "0.1.0", "shortName": "ADM", "productName": "ADM",
        }), encoding="utf-8")
        self.directories = []
        for platform, arch, installer in [("mac", "arm64", ".dmg"), ("win", "x64", "-setup.exe")]:
            target = f"{platform}-{arch}"
            directory = self.downloads / f"ADM-{TAG}-{target}"
            directory.mkdir(parents=True)
            self.directories.append(directory)
            files = []
            for suffix in [".zip", installer]:
                path = directory / f"ADM-0.1.0-{target}{suffix}"
                path.write_bytes(f"{target}{suffix}".encode())
                files.append({"file": path.name, "size": path.stat().st_size, "sha256": release.digest(path)})
            (directory / "build-info.json").write_text(json.dumps({
                "product": "ADM", "framework": "Tauri 2", "version": "0.1.0", "tag": TAG,
                "commit": COMMIT, "platform": platform, "arch": arch, "distributionReview": "ready",
                "legalManifestSha256": release.digest(self.root / "legal/manifest.json"), "files": files,
            }), encoding="utf-8")
            (directory / "SHA256SUMS.txt").write_text(
                "".join(f"{item['sha256']}  {item['file']}\n" for item in files), encoding="utf-8",
            )

    def prepare(self):
        return release.prepare_assets(self.root, self.downloads, self.output, TAG, COMMIT)

    def remote(self, assets, draft=True):
        return {"html_url": URL, "draft": draft, "assets": [
            {"name": path.name, "size": path.stat().st_size,
             "state": "uploaded", "digest": f"sha256:{release.digest(path)}"} for path in assets
        ]}

    def test_combines_both_platforms_without_overwriting_build_info(self):
        assets = self.prepare()
        self.assertEqual(len(assets), 7)
        for target in ["mac-arm64", "win-x64"]:
            self.assertTrue((self.output / f"build-info-{target}.json").is_file())
        lines = (self.output / "SHA256SUMS.txt").read_text().splitlines()
        self.assertEqual(len(lines), 6)
        for line in lines:
            expected, name = line.split("  ")
            self.assertEqual(release.digest(self.output / name), expected)

    def test_missing_platform_stops_before_creating_output(self):
        shutil.rmtree(self.directories[1])
        with self.assertRaises(FileNotFoundError):
            self.prepare()
        self.assertFalse(self.output.exists())

    def test_recorded_official_adb_policy_remains_open_in_build_info(self):
        policy = {"status": "open-review", "distributionPolicy": "retain-official-adb"}
        (self.root / "legal/release-review.json").write_text(json.dumps(policy))
        for directory in self.directories:
            path = directory / "build-info.json"
            info = json.loads(path.read_text())
            info.update(distributionReview=policy["status"], distributionPolicy=policy["distributionPolicy"])
            path.write_text(json.dumps(info))
        self.prepare()
        actual = json.loads((self.output / "build-info-win-x64.json").read_text())
        self.assertEqual(actual["distributionReview"], "open-review")

    def test_mismatched_source_or_review_is_rejected(self):
        path = self.directories[1] / "build-info.json"
        original = json.loads(path.read_text())
        for key, value in [("commit", "b" * 40), ("tag", "v0.1.0-old"), ("version", "9.0.0"),
                           ("platform", "mac"), ("legalManifestSha256", "wrong"),
                           ("distributionReview", "pending")]:
            with self.subTest(key=key):
                path.write_text(json.dumps({**original, key: value}))
                with self.assertRaisesRegex(ValueError, key):
                    self.prepare()
                self.assertFalse(self.output.exists())

    def test_corrupted_asset_and_invalid_file_names_are_rejected(self):
        path = self.directories[0] / "build-info.json"
        info = json.loads(path.read_text())
        info["files"][0]["file"] = "../../unexpected.zip"
        path.write_text(json.dumps(info))
        with self.assertRaisesRegex(ValueError, "意外文件"):
            self.prepare()
        info["files"][0]["file"] = "ADM-0.1.0-mac-arm64.zip"
        path.write_text(json.dumps(info))
        binary = self.directories[0] / info["files"][0]["file"]
        binary.write_bytes(b"x" * binary.stat().st_size)
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            self.prepare()

    def test_publishes_only_after_all_assets_are_verified_and_marks_test_tags(self):
        assets = self.prepare()
        for tag, prerelease in [(TAG, "true"), ("v0.1.0", "false")]:
            with self.subTest(tag=tag), patch.object(release, "gh", return_value=json.dumps({"sha": COMMIT})) as gh:
                with patch.object(release, "get_release", side_effect=[None, self.remote(assets)]):
                    self.assertEqual(release.publish(REPOSITORY, tag, COMMIT, assets), URL)
                calls = [call.args for call in gh.call_args_list]
                self.assertEqual([call[1] for call in calls[1:]], ["create", "upload", "edit"])
                self.assertIn("--draft", calls[1])
                self.assertIn("--verify-tag", calls[1])
                self.assertIn("--notes-file", calls[1])
                self.assertIn(f"--prerelease={prerelease}", calls[-1])
                self.assertEqual("--latest=false" in calls[-1], prerelease == "true")

    def test_upload_failure_does_not_publish_draft(self):
        assets = self.prepare()

        def gh(*args):
            if args[:2] == ("release", "upload"):
                raise subprocess.CalledProcessError(1, "gh", stderr="upload failed")
            return json.dumps({"sha": COMMIT})

        with patch.object(release, "gh", side_effect=gh) as runner:
            with patch.object(release, "get_release", return_value=None):
                with self.assertRaises(subprocess.CalledProcessError):
                    release.publish(REPOSITORY, TAG, COMMIT, assets)
            self.assertFalse(any(call.args[:2] == ("release", "edit") for call in runner.call_args_list))

    def test_incomplete_remote_upload_does_not_publish(self):
        assets = self.prepare()
        with patch.object(release, "gh", return_value=json.dumps({"sha": COMMIT})) as gh:
            with patch.object(release, "get_release", side_effect=[None, self.remote(assets[:-1])]):
                with self.assertRaisesRegex(ValueError, "附件未齐全"):
                    release.publish(REPOSITORY, TAG, COMMIT, assets)
            self.assertFalse(any(call.args[:2] == ("release", "edit") for call in gh.call_args_list))

    def test_existing_draft_can_resume_without_creating_another_release(self):
        assets = self.prepare()
        with patch.object(release, "gh", return_value=json.dumps({"sha": COMMIT})) as gh:
            with patch.object(release, "get_release", side_effect=[self.remote([]), self.remote(assets)]):
                release.publish(REPOSITORY, TAG, COMMIT, assets)
            self.assertEqual([call.args[1] for call in gh.call_args_list[1:]], ["upload", "edit"])

    def test_published_release_is_checked_without_overwriting(self):
        assets = self.prepare()
        remote = self.remote(assets, draft=False)
        with patch.object(release, "gh", return_value=json.dumps({"sha": COMMIT})) as gh:
            with patch.object(release, "get_release", return_value=remote):
                self.assertEqual(release.publish(REPOSITORY, TAG, COMMIT, assets), URL)
                remote["assets"][0]["digest"] = "sha256:wrong"
                with self.assertRaisesRegex(ValueError, "不能自动覆盖"):
                    release.publish(REPOSITORY, TAG, COMMIT, assets)
            self.assertTrue(all(call.args[0] == "api" for call in gh.call_args_list))

    def test_moved_tag_stops_before_mutating_release(self):
        with patch.object(release, "gh", return_value=json.dumps({"sha": "b" * 40})) as gh:
            with self.assertRaisesRegex(ValueError, "tag 已变化"):
                release.publish(REPOSITORY, TAG, COMMIT, self.prepare())
            gh.assert_called_once()

    def test_tag_404_requires_checking_paginated_drafts(self):
        error = subprocess.CalledProcessError(1, "gh", stderr="gh: Not Found (HTTP 404)")
        draft = {"tag_name": TAG, "draft": True, "id": 123}
        pages = [[{"tag_name": "v0.0.1", "draft": False}], [draft]]
        with patch.object(release, "gh", side_effect=[error, json.dumps(pages)]) as gh:
            self.assertEqual(release.get_release(REPOSITORY, TAG), draft)
            self.assertEqual(gh.call_args.args, (
                "api", "--paginate", "--slurp", f"repos/{REPOSITORY}/releases?per_page=100",
            ))
        with patch.object(release, "gh", side_effect=[error, "[[]]"]):
            self.assertIsNone(release.get_release(REPOSITORY, TAG))
        with patch.object(release, "gh", side_effect=[error, error]):
            with self.assertRaises(subprocess.CalledProcessError):
                release.get_release(REPOSITORY, TAG)

    def test_duplicate_drafts_are_not_chosen_arbitrarily(self):
        error = subprocess.CalledProcessError(1, "gh", stderr="gh: Not Found (HTTP 404)")
        drafts = [[{"tag_name": TAG, "id": 1}, {"tag_name": TAG, "id": 2}]]
        with patch.object(release, "gh", side_effect=[error, json.dumps(drafts)]):
            with self.assertRaisesRegex(ValueError, "多个 Release 草稿"):
                release.get_release(REPOSITORY, TAG)

    def test_permission_and_server_errors_are_not_treated_as_missing(self):
        for status in [403, 500]:
            error = subprocess.CalledProcessError(1, "gh", stderr=f"gh: failure (HTTP {status})")
            with self.subTest(status=status), patch.object(release, "gh", side_effect=error) as gh:
                with self.assertRaises(subprocess.CalledProcessError):
                    release.get_release(REPOSITORY, TAG)
                gh.assert_called_once()

    def test_main_stops_at_existing_distribution_gate(self):
        with patch("sys.argv", ["release_ci.py", "--publish"]):
            with patch.object(release.subprocess, "run", side_effect=subprocess.CalledProcessError(1, "node")):
                with patch.object(release, "prepare_assets") as prepare, patch.object(release, "publish") as publish:
                    with self.assertRaises(subprocess.CalledProcessError):
                        release.main()
                    prepare.assert_not_called()
                    publish.assert_not_called()


if __name__ == "__main__":
    unittest.main()
