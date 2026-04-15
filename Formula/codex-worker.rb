class CodexWorker < Formula
  desc "Daemon-backed Codex app-server worker CLI"
  homepage "https://github.com/yigitkonur/codex-worker"
  version "0.1.14"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/yigitkonur/codex-worker/releases/download/v0.1.14/codex-worker-darwin-arm64"
      sha256 "d537f12f2c2fd3da147ae750eed4e0456881d8be378d7bbf903a4c0a12f6eaf5"
    else
      url "https://github.com/yigitkonur/codex-worker/releases/download/v0.1.14/codex-worker-darwin-x64"
      sha256 "e23b1bd6e8eba3057d282984df83a8a20aa6d024f48b2f46d74f5f3c0a4d6866"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/yigitkonur/codex-worker/releases/download/v0.1.14/codex-worker-linux-arm64"
      sha256 "d718f477d3d0dbe84b88295fd176c0d9580de49b9da7ab75636719539966c5a5"
    else
      url "https://github.com/yigitkonur/codex-worker/releases/download/v0.1.14/codex-worker-linux-x64"
      sha256 "2727210d5dea49204a3a99ea0076e43c4130ce8ea2567b98591b1aacf2ae9d8b"
    end
  end

  def install
    bin.install downloaded_file => "codex-worker"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/codex-worker --version")
  end
end
