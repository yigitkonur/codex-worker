class CodexWorker < Formula
  desc "Daemon-backed Codex app-server worker CLI"
  homepage "https://github.com/yigitkonur/codex-worker"
  version "0.1.17"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/yigitkonur/codex-worker/releases/download/v0.1.17/codex-worker-darwin-arm64"
      sha256 "2cf8335c7a10db58a803d222b05a7abee8318c3efb75eb15421aa56d51092e49"
    else
      url "https://github.com/yigitkonur/codex-worker/releases/download/v0.1.17/codex-worker-darwin-x64"
      sha256 "694bdf9a1ea1571a8e760c16b0fa4857e32d5c3156d35abe151e17b937e70701"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/yigitkonur/codex-worker/releases/download/v0.1.17/codex-worker-linux-arm64"
      sha256 "55ba4a315bec2bbdd46b8b860e9a45f236aafd1091ca0ec2b697d0c28453f5dc"
    else
      url "https://github.com/yigitkonur/codex-worker/releases/download/v0.1.17/codex-worker-linux-x64"
      sha256 "15b5e168926b0d2cc8d8d53353d09572f8ef4d50770170e22ce19a5c89661fab"
    end
  end

  def install
    bin.install downloaded_file => "codex-worker"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/codex-worker --version")
  end
end
