{
  "targets": [
    {
      "target_name": "rootherald_napi",
      "sources": [
        "src/rootherald_napi.cc"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "../../../clients/common",
        "../../../clients/windows"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS"
      ],
      "conditions": [
        ["OS==\"win\"", {
          "libraries": [
            "../../../../build/windows/Release/RootHerald.lib"
          ],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "AdditionalOptions": ["/std:c++17"]
            }
          }
        }],
        ["OS==\"linux\"", {
          "libraries": ["-lrootherald"]
        }],
        ["OS==\"mac\"", {
          "libraries": ["-lrootherald"]
        }]
      ]
    }
  ]
}
