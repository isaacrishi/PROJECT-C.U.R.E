# Security Policy

**Project C.U.R.E.** (*Cellular Understanding & Research Environment*) is developed and maintained by **I.R.A.I Corp**. Because our platform supports biomedical and oncology research workflows, we prioritize software integrity, local data privacy, and responsible vulnerability disclosure.

---

## Supported Versions

Only the latest release and main branch artifacts are actively maintained and eligible for security updates:

| Version / Artifact | Supported | Notes |
| :--- | :---: | :--- |
| `main` branch (`Project-CURE-desktop-1.34GB.zip`) | ✅ | Current supported macOS Apple Silicon build |
| Older commits / archived builds | ❌ | Unsupported; please pull the latest release |

---

## Local-First Data Privacy & Biomedical Compliance

Project C.U.R.E. is engineered as a **local-first macOS workstation**:
* **No External Telemetry or Cloud Uploads:** Cellular imagery, experimental datasets, and analysis results remain strictly on the user's local macOS filesystem.
* **Research Disclaimer:** Project C.U.R.E. is an experimental computational research tool. Users handling sensitive laboratory datasets, de-identified specimens, or regulated biomedical information are responsible for maintaining appropriate local disk encryption (e.g., macOS FileVault) and institutional compliance (such as HIPAA, GDPR, or local institutional review guidelines).

---

## Binary Integrity & macOS Gatekeeper Notice

* Official macOS desktop releases are distributed exclusively through the official **I.R.A.I Corp** GitHub repository (`https://github.com/isaacrishi/PROJECT-C.U.R.E`) via Git LFS.
* Because independent research builds may not carry an Apple Developer notarization ticket, macOS Gatekeeper may flag the extracted `.app` bundle on first launch. Always verify that you cloned directly from `isaacrishi/PROJECT-C.U.R.E` before clearing the quarantine attribute (`xattr -cr "app/Project C.U.R.E..app"`).

---

## Reporting a Vulnerability

If you discover a security vulnerability, dependency flaw, or data-handling issue in Project C.U.R.E., **please do not open a public GitHub Issue**.

Instead, report it privately so we can investigate and patch it before public disclosure:

1. **GitHub Private Vulnerability Reporting:** Use the **"Report a vulnerability"** button under the **Security** tab of `isaacrishi/PROJECT-C.U.R.E` (if enabled).
2. **Direct Contact:** Reach out directly to **I.R.A.I Corp** via our official correspondence email with the subject line: `[SECURITY] Project C.U.R.E. Vulnerability Report`.

### What to Include in Your Report
* A clear description of the vulnerability and its potential impact.
* Step-by-step instructions or a minimal proof-of-concept to reproduce the issue on macOS.
* Your macOS version, hardware architecture (e.g., Apple Silicon M1–M4), and the commit hash or release archive tested.

---

## Disclosure & Response Timeline

* **Acknowledgment:** We aim to acknowledge receipt of security reports within **48–72 hours**.
* **Assessment & Remediation:** Validated issues will be triaged, patched in the `main` branch, and packaged into an updated Git LFS desktop archive as quickly as possible.
* **Coordinated Disclosure:** We ask researchers to allow reasonable time for a fix to be published before sharing vulnerability details publicly.

---

*Maintained by **I.R.A.I Corp** • Repository: [isaacrishi/PROJECT-C.U.R.E](https://github.com/isaacrishi/PROJECT-C.U.R.E)*
