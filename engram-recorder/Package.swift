// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "EngramRecorderCore",
  platforms: [.macOS(.v15)],
  products: [
    .library(name: "EngramAuthCore", targets: ["EngramAuthCore"]),
    .library(name: "EngramArchiveCore", targets: ["EngramArchiveCore"]),
  ],
  targets: [
    .target(
      name: "EngramAuthCore",
      dependencies: ["EngramArchiveCore"],
      path: "Engram Recorder/Services",
      exclude: ["GoogleMeetDetector.swift"],
      sources: [
        "EngramAPIClient.swift",
        "EngramAuthSession.swift",
        "EngramOAuthClient.swift",
        "KeychainStore.swift",
        "PKCE.swift",
      ]
    ),
    .target(
      name: "EngramArchiveCore",
      path: "Engram Recorder/Recording",
      exclude: ["AudioCaptureService.swift", "RecorderController.swift"],
      sources: ["Models.swift", "RecordingArchive.swift"]
    ),
    .testTarget(
      name: "EngramAuthCoreTests",
      dependencies: ["EngramAuthCore"],
      path: "Tests/EngramAuthCoreTests"
    ),
    .testTarget(
      name: "EngramArchiveCoreTests",
      dependencies: ["EngramArchiveCore"],
      path: "Tests/EngramArchiveCoreTests"
    ),
  ]
)
