Project C.U.R.E.

Developed by I.R.A.I Corp
A standalone macOS research workstation engineered for high-speed cancer cell analysis, cellular diagnostics, and next-generation precision oncology.

Overview

Project C.U.R.E. brings computational biology and desktop performance together in a self-contained macOS environment. Designed for oncology researchers, PhD scholars, and clinical specialists, it enables local cellular diagnostics and therapeutic modeling directly on Mac hardware—eliminating cloud latency, external compute dependencies, and data-privacy bottlenecks.

Core Capabilities

High-Speed Cellular Analysis: Rapidly examine malignant cell morphology, anomaly patterns, and biomarker behavior locally on macOS.
Self-Contained Biomedical Workflows: Run integrated analytical simulations, sequence and therapeutic modeling, and visual diagnostics without external cloud infrastructure.
Privacy-First Local Execution: Keep sensitive cellular imaging and research datasets entirely on local storage.
Future-Ready Precision Oncology: Built to help laboratories and clinicians prototype targeted therapies and cellular insights faster in the next era of decentralized medical research.
System Requirements

Operating System: macOS (Apple Silicon recommended)
Storage: ~2 GB of free disk space (to accommodate the ~444 MB compressed Git LFS archive and the ~1.34 GB extracted .app bundle)
Tools (for Git installation): git and git-lfs
Quick Start: Download & Launch on macOS

Because the prebuilt macOS desktop bundle (Project-CURE-desktop-1.34GB.zip) is tracked via Git LFS, follow the steps below to clone, extract, and launch the application cleanly.

1. Install Git LFS (if not already installed)

brew install git-lfs
git lfs install

2. Clone the Repository

git clone https://github.com/isaacrishi/PROJECT-C.U.R.E.git
cd PROJECT-C.U.R.E
(Note: Git LFS will automatically download Project-CURE-desktop-1.34GB.zip (~444 MB) during checkout. If it downloads as a small pointer file, run git lfs pull.)

3. Extract and Launch the Application

Because this build is distributed outside the Mac App Store, macOS Gatekeeper may apply a quarantine attribute upon download. Run the following commands in Terminal to unpack and open the workstation:

unzip -q Project-CURE-desktop-1.34GB.zip -d app
xattr -cr "app/Project C.U.R.E..app"
open "app/Project C.U.R.E..app"
(Alternatively, after unzipping, you can right-click Project C.U.R.E..app in Finder, select Open, and confirm in System Settings > Privacy & Security.)

Repository Structure

PROJECT-C.U.R.E/
├── Project-CURE-desktop-1.34GB.zip   # Packaged macOS desktop application bundle (tracked via Git LFS)
├── .gitattributes                    # Git LFS tracking configuration for large binary archives
└── README.md                         # Project overview, architecture, and macOS installation guide
Research & Collaboration

Project C.U.R.E. is actively developed by I.R.A.I Corp to support oncology research and clinical innovation. Scientific feedback, clinical insights, and collaboration inquiries are warmly welcomed—feel free to open an Issue or reach out directly.

Disclaimer

Project C.U.R.E. is intended for research and educational use in computational biology and cellular analysis. It is not a certified medical device and should not be used as a standalone clinical diagnostic tool without appropriate regulatory validation.
