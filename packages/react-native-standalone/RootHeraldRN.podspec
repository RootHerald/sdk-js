require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "RootHeraldRN"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://rootherald.io"
  s.license      = { :type => "Apache-2.0" }
  s.authors      = { "Root Herald" => "engineering@rootherald.io" }
  s.platforms    = { :ios => "14.0" }
  s.source       = { :git => "https://github.com/rootherald/rootherald.git", :tag => "#{s.version}" }

  s.source_files = "ios/**/*.{h,m,mm,swift}"
  s.swift_version = "5.9"

  # React Native runtime
  s.dependency "React-Core"
  # The shipped native attestation SDK from Wave 3
  s.dependency "RootHeraldKit", ">= 0.2.0"
end
