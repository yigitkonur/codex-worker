class CodexWorker < Formula
  desc "Daemon-backed Codex app-server worker CLI"
  homepage "https://github.com/yigitkonur/codex-worker"
  version "0.1.13"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/yigitkonur/codex-worker/releases/download/v0.1.13/codex-worker-darwin-arm64"
      sha256 "6a75d22629a594912c919e15a522cbc2739c9def56e6bd0d4c4720ded67ec88e"
    else
      url "https://github.com/yigitkonur/codex-worker/releases/download/v0.1.13/codex-worker-darwin-x64"
      sha256 "872ffddde57c8d1621be3642e4cea7b5dea937d3503702aac45f5f584f805294"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/yigitkonur/codex-worker/releases/download/v0.1.13/codex-worker-linux-arm64"
      sha256 "aad8bf49ca3707869fb7c453ce2bd786cc8914bffac1007306e0e02e1217fb02"
    else
      url "https://github.com/yigitkonur/codex-worker/releases/download/v0.1.13/codex-worker-linux-x64"
      sha256 "0ce708c47d1a1c8bac02d9582301961460200c83a26e93fc219af66a6464a61e"
    end
  end

  def install
    bin.install downloaded_file => "codex-worker"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/codex-worker --version")
  end
end
