class CodexWorker < Formula
  desc "Daemon-backed Codex app-server worker CLI"
  homepage "https://github.com/yigitkonur/codex-worker"
  version "0.1.16"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/yigitkonur/codex-worker/releases/download/v0.1.16/codex-worker-darwin-arm64"
      sha256 "cb6353b1eab04303d26e882f95cee4fd19e8a69f778a0a70139d2fe37b7803de"
    else
      url "https://github.com/yigitkonur/codex-worker/releases/download/v0.1.16/codex-worker-darwin-x64"
      sha256 "30a71418be9f9034f1a3e794b07e12d3baf4068b28efb3b5b3e37e5d8c5757c3"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/yigitkonur/codex-worker/releases/download/v0.1.16/codex-worker-linux-arm64"
      sha256 "15fd474a5c3bea060811f5040aa48935b02cb43b33e970dfc99108b230a571be"
    else
      url "https://github.com/yigitkonur/codex-worker/releases/download/v0.1.16/codex-worker-linux-x64"
      sha256 "be741c6f2c1e5b9b939ceddf3baf83ccf181780abafdd42acb2fd1e6d7beefa6"
    end
  end

  def install
    bin.install downloaded_file => "codex-worker"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/codex-worker --version")
  end
end
