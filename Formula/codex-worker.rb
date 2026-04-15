class CodexWorker < Formula
  desc "Daemon-backed Codex app-server worker CLI"
  homepage "https://github.com/yigitkonur/codex-worker"
  version "0.1.19"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/yigitkonur/codex-worker/releases/download/v0.1.19/codex-worker-darwin-arm64"
      sha256 "c2cb2b988f0f910af4429c44b3cb915b7cc3ea9829541b34966e9ffdc3d3f2b0"
    else
      url "https://github.com/yigitkonur/codex-worker/releases/download/v0.1.19/codex-worker-darwin-x64"
      sha256 "84c260985907040331762a831dbdaff375f33eb6ddf205cb6af743ea83fbee9f"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/yigitkonur/codex-worker/releases/download/v0.1.19/codex-worker-linux-arm64"
      sha256 "bae27eed594c6925890e784d0195c613085849d1d530f5c3ab09f79f304ef5fd"
    else
      url "https://github.com/yigitkonur/codex-worker/releases/download/v0.1.19/codex-worker-linux-x64"
      sha256 "64532a3dfe31acc146149cef9bd3f98a266357287380cee842883c7e58999b61"
    end
  end

  def install
    bin.install downloaded_file => "codex-worker"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/codex-worker --version")
  end
end
