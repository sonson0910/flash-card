import hashlib
import io
import json
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("extract-release-archive.py")


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


class ExtractReleaseArchiveTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="extract-release-archive-")
        self.root = Path(self.temp.name)
        self.candidate = self.root / "candidate"
        self.archive = self.root / "candidate.tar.gz"
        self.output = self.root / "extracted"
        self._write_candidate()

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _write_candidate(self) -> None:
        files = {
            "dist/index.html": b"<main>release</main>\n",
            "functions/lib/index.js": b"export const ready = true;\n",
            "package.json": b'{"private":true}\n',
            "artifacts/phase6-readiness.json": b'{"revision":"a","releaseEligible":true}\n',
        }
        for relative, content in files.items():
            destination = self.candidate / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(content)

        component_values = {}
        for relative, content in files.items():
            record = {
                "path": relative,
                "bytes": len(content),
                "sha256": digest(content),
            }
            if relative == "dist/index.html":
                component_values["dist"] = {
                    "path": "dist",
                    "files": [record],
                    "treeSha256": digest(json.dumps([record], separators=(",", ":")).encode()),
                }
            elif relative == "functions/lib/index.js":
                component_values["functionsLib"] = {
                    "path": "functions/lib",
                    "files": [record],
                    "treeSha256": digest(json.dumps([record], separators=(",", ":")).encode()),
                }
            elif relative == "package.json":
                component_values["rootPackage"] = record
            else:
                component_values["readiness"] = record

        manifest = {
            "schemaVersion": 1,
            "revision": "a" * 40,
            "workflowRunId": "12345",
            "generatedAt": "2026-09-06T00:00:00.000Z",
            "components": component_values,
            "candidateSha256": "b" * 64,
        }
        manifest_path = self.candidate / "artifacts/release-candidate-manifest.json"
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text(json.dumps(manifest, separators=(",", ":")), encoding="utf-8")
        self.receipt = self.root / "release-archive-receipt.json"
        self.receipt.write_text(
            json.dumps({
                "schemaVersion": 1,
                "status": "sealed",
                "revision": "a" * 40,
                "sourceRunId": "12345",
                "candidateSha256": "b" * 64,
            }),
            encoding="utf-8",
        )

    def _write_archive(self, mutate=None) -> None:
        with tarfile.open(self.archive, "w:gz") as archive:
            archive.add(self.candidate, arcname="candidate")
            archive.add(self.receipt, arcname="release-archive-receipt.json")
            if mutate is not None:
                mutate(archive)

    def _run(self, archive=None, output=None):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), str(archive or self.archive), str(output or self.output)],
            check=False,
            capture_output=True,
            text=True,
        )
        return result

    def test_extracts_valid_candidate_and_embedded_receipt(self) -> None:
        self._write_archive()

        result = self._run()

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            (self.output / "candidate/dist/index.html").read_bytes(),
            b"<main>release</main>\n",
        )
        self.assertTrue((self.output / "candidate/artifacts/release-candidate-manifest.json").is_file())
        self.assertEqual(
            (self.output / "release-archive-receipt.json").read_text(encoding="utf-8"),
            self.receipt.read_text(encoding="utf-8"),
        )

    def test_rejects_injected_dotenv_before_extraction(self) -> None:
        injected = self.candidate / ".env"
        injected.write_text("SECRET=must-not-ship\n", encoding="utf-8")
        self._write_archive()

        result = self._run()

        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.output.exists())

    def test_rejects_path_traversal_before_extraction(self) -> None:
        def add_traversal(archive: tarfile.TarFile) -> None:
            payload = b"outside\n"
            member = tarfile.TarInfo("candidate/../../outside.txt")
            member.size = len(payload)
            archive.addfile(member, io.BytesIO(payload))

        self._write_archive(add_traversal)

        result = self._run()

        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.output.exists())
        self.assertFalse((self.root / "outside.txt").exists())

    def test_rejects_links_before_extraction(self) -> None:
        def add_link(archive: tarfile.TarFile) -> None:
            member = tarfile.TarInfo("candidate/dist/link.js")
            member.type = tarfile.SYMTYPE
            member.linkname = "index.html"
            archive.addfile(member)

        self._write_archive(add_link)

        result = self._run()

        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.output.exists())

    def test_rejects_duplicate_members_before_extraction(self) -> None:
        def add_duplicate(archive: tarfile.TarFile) -> None:
            archive.add(self.candidate / "dist/index.html", arcname="candidate/dist/index.html")

        self._write_archive(add_duplicate)

        result = self._run()

        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.output.exists())

    def test_requires_absent_or_empty_output_directory(self) -> None:
        self._write_archive()
        self.output.mkdir()
        (self.output / "existing.txt").write_text("keep", encoding="utf-8")

        result = self._run()

        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.output / "existing.txt").read_text(encoding="utf-8"), "keep")


if __name__ == "__main__":
    unittest.main()
