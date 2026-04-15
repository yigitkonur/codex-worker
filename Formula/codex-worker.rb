class CodexWorker < Formula
  desc "Daemon-backed Codex app-server worker CLI"
  homepage "https://github.com/yigitkonur/codex-worker"
  version "0.1.18"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/yigitkonur/codex-worker/releases/download/v0.1.18/codex-worker-darwin-arm64"
      sha256 "3aae139de03c8f4820c6c858b6c0adaab3c24166b2ea26b99a34c30b9797526d"
    else
      url "https://github.com/yigitkonur/codex-worker/releases/download/v0.1.18/codex-worker-darwin-x64"
      sha256 "9a053796049cacd5e2aa62675cbe832c16eb3e453139edc89d77086bc44ed510"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/yigitkonur/codex-worker/releases/download/v0.1.18/codex-worker-linux-arm64"
      sha256 "912c178b9eebfd71e3df4647a9478537c5f17c4329bd228ec11de86bd5af950f"
    else
      url "https://github.com/yigitkonur/codex-worker/releases/download/v0.1.18/codex-worker-linux-x64"
      sha256 "f5b874b2b7e135b64ececa9c91dab13c80f230670544eb919c6a4741ae60d9b3"
    end
  end

  def install
    bin.install downloaded_file => "codex-worker"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/codex-worker --version")
  end
end
