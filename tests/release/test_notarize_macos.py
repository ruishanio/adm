"""离线检查公证失败门禁、凭据脱敏、原生组件签名及临时钥匙串清理。"""
import base64
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

from scripts import notarize_macos as signing


def fixture_credentials():
    return {
        "APPLE_CERTIFICATE": base64.b64encode(b"test certificate").decode(),
        "APPLE_CERTIFICATE_PASSWORD": "test-p12-password",
        "APPLE_SIGNING_IDENTITY": "Developer ID Application: Example (TEAM123456)",
        "APPLE_ID": "test@example.invalid",
        "APPLE_PASSWORD": "aaaa-bbbb-cccc-dddd",
        "APPLE_TEAM_ID": "TEAM123456",
    }


class NotarizationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="adm-notary-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.values = fixture_credentials()

    def test_missing_secrets_wrong_team_or_invalid_certificate_fail_closed(self):
        for key in signing.SECRET_NAMES:
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, key):
                signing.credentials({name: value for name, value in self.values.items() if name != key})
        with self.assertRaisesRegex(ValueError, "同一团队"):
            signing.credentials({**self.values, "APPLE_TEAM_ID": "OTHER"})
        with self.assertRaisesRegex(ValueError, "Base64"):
            signing.credentials({**self.values, "APPLE_CERTIFICATE": "not base64!"})

    def test_command_failure_and_timeout_never_echo_credentials(self):
        with patch.dict(signing.os.environ, self.values):
            run = signing.Runner(self.values.values())
        self.assertFalse(set(signing.SECRET_NAMES) & set(run.environ))
        secret = self.values["APPLE_PASSWORD"]
        failure = subprocess.CompletedProcess([], 1, stdout=secret, stderr=secret)
        with patch.object(signing.subprocess, "run", return_value=failure):
            with self.assertRaises(RuntimeError) as error:
                run(["xcrun", "--password", secret])
            self.assertNotIn(secret, str(error.exception))
        with patch.object(signing.subprocess, "run", side_effect=subprocess.TimeoutExpired([secret], 1)):
            with self.assertRaisesRegex(RuntimeError, "执行超时") as error:
                run(["xcrun", "--password", secret])
            self.assertNotIn(secret, str(error.exception))

    def test_authentication_failure_restores_search_list_and_deletes_private_key(self):
        run = Mock()
        run.hidden = []
        paths = []

        def execute(args):
            if args == ["security", "list-keychains", "-d", "user"]:
                return '"/original/login keychain-db"\n'
            if args[1] == "find-identity":
                return self.values["APPLE_SIGNING_IDENTITY"]
            if args[1] == "import":
                paths.append(args[2])
                self.assertTrue(args[2].is_file())
            if args[1:3] == ["notarytool", "store-credentials"]:
                raise RuntimeError("Apple authentication failed")
            return ""

        run.side_effect = execute
        with self.assertRaisesRegex(RuntimeError, "authentication failed"):
            with signing.signing_keychain(run, self.values):
                self.fail("认证失败后不可进入签名阶段")
        calls = [call.args[0] for call in run.call_args_list]
        self.assertIn(["security", "list-keychains", "-d", "user", "-s", "/original/login keychain-db"], calls)
        self.assertEqual(calls[-1][1], "delete-keychain")
        self.assertTrue(paths)
        self.assertFalse(paths[0].parent.exists())

    def test_macho_including_universal_adb_is_signed_before_app(self):
        app = self.root / "ADM.app"
        main = app / "Contents/MacOS/adm"
        adb = app / "Contents/Resources/platform-tools/adb"
        for file, header in [(main, "cffaedfe"), (adb, "cafebabe")]:
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(bytes.fromhex(header) + b"test")
        (adb.parent / "NOTICE.txt").write_text("not executable")
        run = Mock()
        signing.sign(run, app, self.root / "keychain", self.values["APPLE_SIGNING_IDENTITY"])
        calls = [call.args[0] for call in run.call_args_list if "--force" in call.args[0]]
        self.assertEqual([call[-1] for call in calls], [adb, main, app])
        self.assertTrue(all("runtime" in call and "--timestamp" in call for call in calls))
        self.assertTrue(all("--deep" not in call for call in calls))

    def test_invalid_or_pending_notarization_cannot_continue_and_retains_submission(self):
        for status in ["Invalid", "In Progress"]:
            with self.subTest(status=status):
                run = Mock()
                run.redact = lambda value: value

                def execute(args, **kwargs):
                    operation = args[2]
                    if operation == "submit":
                        return json.dumps({"id": "submission-id"})
                    if operation == "wait":
                        raise RuntimeError("wait failed")
                    if operation == "info":
                        return json.dumps({"id": "submission-id", "status": status})
                    return ""

                run.side_effect = execute
                with self.assertRaisesRegex(RuntimeError, status):
                    signing.notarize(run, self.root / "app.zip", self.root / "keychain", self.root, "app")
                self.assertEqual(json.loads((self.root / "app-submission.json").read_text())["id"], "submission-id")
                calls = [call.args[0][2] for call in run.call_args_list]
                self.assertEqual(calls.count("submit"), 1)
                self.assertEqual("log" in calls, status == "Invalid")

    def test_rejected_app_stops_before_dmg_and_removes_old_distribution_files(self):
        (self.root / "package.json").write_text(json.dumps({
            "productName": "ADM", "shortName": "ADM", "version": "0.1.6",
        }))
        contents = self.root / "release/mac-arm64/ADM.app/Contents"
        contents.mkdir(parents=True)
        (contents / "Info.plist").write_text("fixture")
        paths = [self.root / f"release/ADM-0.1.6-mac-arm64.{extension}" for extension in ["zip", "dmg"]]
        for path in paths:
            path.write_text("old unsigned package")
        run = Mock()
        with patch.object(signing, "sign"), patch.object(signing, "notarize", side_effect=RuntimeError("Invalid")):
            with patch.object(signing, "staple_and_assess") as staple:
                with self.assertRaisesRegex(RuntimeError, "Invalid"):
                    signing.package(run, self.values, self.root / "keychain", self.root)
                staple.assert_not_called()
        self.assertTrue(all(not path.exists() for path in paths))
        self.assertFalse(any("build" in call.args[0] for call in run.call_args_list))


if __name__ == "__main__":
    unittest.main()
