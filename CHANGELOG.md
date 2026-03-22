## [1.8.8](https://github.com/Owloops/browserbird/compare/v1.8.7...v1.8.8) (2026-03-22)


### Bug Fixes

* **web:** add mobile virtual keyboard to vnc viewer ([c38f0ae](https://github.com/Owloops/browserbird/commit/c38f0ae32085dcc693d876022de2ebe9b1b6748c))

## [1.8.7](https://github.com/Owloops/browserbird/compare/v1.8.6...v1.8.7) (2026-03-22)


### Bug Fixes

* **slack:** reinitialize plan header and tool count after stream reset ([637d56d](https://github.com/Owloops/browserbird/commit/637d56da365a934b93c6e1a80c98ef7bc60967bb))

## [1.8.6](https://github.com/Owloops/browserbird/compare/v1.8.5...v1.8.6) (2026-03-22)


### Bug Fixes

* **docs:** add vault key usage examples for cookies and github tokens ([e7d6dbc](https://github.com/Owloops/browserbird/commit/e7d6dbc1f7c84964bea8a3982ce3f1b04128e6d8))

## [1.8.5](https://github.com/Owloops/browserbird/compare/v1.8.4...v1.8.5) (2026-03-22)


### Bug Fixes

* **slack:** reset stream before hitting message size limit ([258f644](https://github.com/Owloops/browserbird/commit/258f644d7838a281ab32e4095dd9a9fc43e603d4))

## [1.8.4](https://github.com/Owloops/browserbird/compare/v1.8.3...v1.8.4) (2026-03-22)


### Bug Fixes

* **slack:** treat msg_too_long as stream expiration and fall back to regular messages ([0c9ac36](https://github.com/Owloops/browserbird/commit/0c9ac36840820c423556f319162084f0279de38d))

## [1.8.3](https://github.com/Owloops/browserbird/compare/v1.8.2...v1.8.3) (2026-03-22)


### Bug Fixes

* **vault:** share name validation between cli and api, clean up bindings on bird delete ([2f0bea9](https://github.com/Owloops/browserbird/commit/2f0bea968791cd11c9e83c7461f7e8d466376792))

## [1.8.2](https://github.com/Owloops/browserbird/compare/v1.8.1...v1.8.2) (2026-03-22)


### Bug Fixes

* **vault:** replace env var blocklist with minimal reserved names ([b40f6b0](https://github.com/Owloops/browserbird/commit/b40f6b05512cdfaf5e7b8da679e1c11b71c745e8))

## [1.8.1](https://github.com/Owloops/browserbird/compare/v1.8.0...v1.8.1) (2026-03-22)


### Bug Fixes

* **web:** persist settings tab selection in url hash ([b1eae90](https://github.com/Owloops/browserbird/commit/b1eae905defc5deba32405ad32f6c702a1a2c1a1))

# [1.8.0](https://github.com/Owloops/browserbird/compare/v1.7.1...v1.8.0) (2026-03-21)


### Bug Fixes

* **slack:** close stream and clear status on msg_too_long errors ([2c657bc](https://github.com/Owloops/browserbird/commit/2c657bcf3aa7f81dcfc993a561bed0f74cacffcf))


### Features

* **cli:** add keys command for vault management ([90de0e5](https://github.com/Owloops/browserbird/commit/90de0e59aabb45923b3fb9b3ce1ead56d313e764))
* **vault:** encrypted key storage with channel/bird binding ([ce33073](https://github.com/Owloops/browserbird/commit/ce33073698d5fb7b687a0c46785425ff8c5d60ec))
* **web:** add keys tab with inline editing and binding management ([d6b7b9f](https://github.com/Owloops/browserbird/commit/d6b7b9f4a5f1045c66b2c4dc346876fd3053afa8))

## [1.7.1](https://github.com/Owloops/browserbird/compare/v1.7.0...v1.7.1) (2026-03-19)


### Bug Fixes

* **provider:** ensure default agent settings on first spawn ([15ead4a](https://github.com/Owloops/browserbird/commit/15ead4a5a3d42d49a5b1c8a7bb3b4bc34d32c539))

# [1.7.0](https://github.com/Owloops/browserbird/compare/v1.6.1...v1.7.0) (2026-03-19)


### Bug Fixes

* **slack:** fall back to regular messages when stream expires ([77e5c3e](https://github.com/Owloops/browserbird/commit/77e5c3e2716fa74113fb5cfbcd19fa5a9f7a1748))


### Features

* **slack:** update plan title dynamically based on tool success and failure counts ([ca88ac1](https://github.com/Owloops/browserbird/commit/ca88ac1b9f08761de2aaafc530e9a590794a626c))

## [1.6.1](https://github.com/Owloops/browserbird/compare/v1.6.0...v1.6.1) (2026-03-19)


### Bug Fixes

* **slack:** add app_home_opened event to manifest URLs and fix formatting ([ef1bf69](https://github.com/Owloops/browserbird/commit/ef1bf69c128bbeb16790f862e5173f259610511e))

# [1.6.0](https://github.com/Owloops/browserbird/compare/v1.5.9...v1.6.0) (2026-03-19)


### Features

* **slack:** add accuracy disclaimer to completion footer ([9fa9d86](https://github.com/Owloops/browserbird/commit/9fa9d86791b59b363d4c80e37b0ccdf9a8592e5b))
* **slack:** add feedback buttons to completion footer with persistence ([8b0171b](https://github.com/Owloops/browserbird/commit/8b0171b668cfce9b38d80689ff2adb288afd037b))
* **slack:** add home tab, dynamic suggested prompts, and refactor db imports ([5bf414b](https://github.com/Owloops/browserbird/commit/5bf414b3ce369f08383845cd95a206cb088165d4))
* **slack:** add prompt titles, context-changed handling, bird thread titles, and expand on sections ([8468e25](https://github.com/Owloops/browserbird/commit/8468e2519ab927c9f810bc3af7d127829a93c83e))
* **slack:** display tool calls as task cards in streamed messages ([3b272f1](https://github.com/Owloops/browserbird/commit/3b272f1f394b1c8ef5d048322353e627be708d2f))
* **slack:** switch to plan display mode and add task details ([359bfda](https://github.com/Owloops/browserbird/commit/359bfdaf64e3bd0b49a1e9f03386c32d5538859a))

## [1.5.9](https://github.com/Owloops/browserbird/compare/v1.5.8...v1.5.9) (2026-03-18)


### Bug Fixes

* **slack:** clear status indicator when session ends ([079abae](https://github.com/Owloops/browserbird/commit/079abaeb36f4cadf0afba256b58885e1e8280174))

## [1.5.8](https://github.com/Owloops/browserbird/compare/v1.5.7...v1.5.8) (2026-03-18)


### Bug Fixes

* **container:** skip google chrome install on arm64 ([8dfb8e4](https://github.com/Owloops/browserbird/commit/8dfb8e40935ab5a147bfcbd7b4aae237c6f92840))

## [1.5.7](https://github.com/Owloops/browserbird/compare/v1.5.6...v1.5.7) (2026-03-18)


### Bug Fixes

* **container:** install google chrome at build time for manual vnc launch ([981b44f](https://github.com/Owloops/browserbird/commit/981b44f5487db1d864909e7f135897db73c1a525))
* **slack:** refresh status indicator on tool use and every 90 seconds ([3307eff](https://github.com/Owloops/browserbird/commit/3307effad6087b776fc440b892795ad8ccf428ac))

## [1.5.6](https://github.com/Owloops/browserbird/compare/v1.5.5...v1.5.6) (2026-03-18)


### Bug Fixes

* **container:** revert chromium path to /opt/google/chrome/chrome ([5c40f99](https://github.com/Owloops/browserbird/commit/5c40f992cba0195dbff888d3c8051e436f6cdfe9))

## [1.5.5](https://github.com/Owloops/browserbird/compare/v1.5.4...v1.5.5) (2026-03-18)


### Bug Fixes

* **container:** use playwright symlink for manual chromium launch ([b8152e6](https://github.com/Owloops/browserbird/commit/b8152e64e7383a96035dc1323fbae416273086d5))

## [1.5.4](https://github.com/Owloops/browserbird/compare/v1.5.3...v1.5.4) (2026-03-17)


### Bug Fixes

* **vnc:** lower quality level and render cursor for better internet performance ([4a82f9a](https://github.com/Owloops/browserbird/commit/4a82f9a566d00d4039e7d1f267abb31f0de265d2))

## [1.5.3](https://github.com/Owloops/browserbird/compare/v1.5.2...v1.5.3) (2026-03-17)


### Bug Fixes

* **web:** rename status page to mission control and browser page to computer ([ce9aa99](https://github.com/Owloops/browserbird/commit/ce9aa99be792902e0f402f5e1185faf613a25972))

## [1.5.2](https://github.com/Owloops/browserbird/compare/v1.5.1...v1.5.2) (2026-03-17)


### Bug Fixes

* **docs:** add railway deployment guidance for region, auto-updates, and service urls ([b6ae4a7](https://github.com/Owloops/browserbird/commit/b6ae4a7e4bd2c72bd08d2d5289f6886e8b17dce6))

## [1.5.1](https://github.com/Owloops/browserbird/compare/v1.5.0...v1.5.1) (2026-03-17)


### Bug Fixes

* **docs:** add stop command to readme and slack manifest urls ([0d1414e](https://github.com/Owloops/browserbird/commit/0d1414edef187ed0095841e1797891744c83476f))

# [1.5.0](https://github.com/Owloops/browserbird/compare/v1.4.22...v1.5.0) (2026-03-17)


### Features

* **slack:** add stop command for sessions and birds ([8a71557](https://github.com/Owloops/browserbird/commit/8a715575d2cfba34d6be3d948660af50a731ab0d))

## [1.4.22](https://github.com/Owloops/browserbird/compare/v1.4.21...v1.4.22) (2026-03-17)


### Bug Fixes

* **birds:** prevent double failure count when stale checker and process both fail ([ca3e1f3](https://github.com/Owloops/browserbird/commit/ca3e1f31e21ec1d9885f339564f85c835b6d0105))
* **sessions:** remove off-by-one in session message count ([3ea0a27](https://github.com/Owloops/browserbird/commit/3ea0a27ebc3b44d35e715e83888d857a1bdb9406))
* **sessions:** use database retention for session cleanup instead of session ttl ([6b68cb0](https://github.com/Owloops/browserbird/commit/6b68cb0894c3003327ae0831a48a83038a9a2f48))

## [1.4.21](https://github.com/Owloops/browserbird/compare/v1.4.20...v1.4.21) (2026-03-16)


### Bug Fixes

* **birds:** format jobs.ts ([e1ba35f](https://github.com/Owloops/browserbird/commit/e1ba35fad0d7d361985d65e8ebbbb8401a37d866))
* **birds:** reset failure count on successful run ([ec5c099](https://github.com/Owloops/browserbird/commit/ec5c099c9b40e9f55459d369f92b7088045dfa82))

## [1.4.20](https://github.com/Owloops/browserbird/compare/v1.4.19...v1.4.20) (2026-03-15)


### Bug Fixes

* **container:** suppress default browser check and first-run prompt ([e530e3f](https://github.com/Owloops/browserbird/commit/e530e3fd3fc189a83f22c2e98b41356fd1c894cc))

## [1.4.19](https://github.com/Owloops/browserbird/compare/v1.4.18...v1.4.19) (2026-03-15)


### Bug Fixes

* **container:** suppress chromium command-line flag security warnings via policy ([3dcbb65](https://github.com/Owloops/browserbird/commit/3dcbb65854e8d5af24c15430628785bd9ef40efb))

## [1.4.18](https://github.com/Owloops/browserbird/compare/v1.4.17...v1.4.18) (2026-03-15)


### Bug Fixes

* **onboarding:** detect pre-configured secrets and make key fields optional ([4fc7746](https://github.com/Owloops/browserbird/commit/4fc7746795e7ecf4c12cfc343e72e2bebdf86024))

## [1.4.17](https://github.com/Owloops/browserbird/compare/v1.4.16...v1.4.17) (2026-03-15)


### Bug Fixes

* **onboarding:** use loaded config for defaults instead of hardcoded values ([4e97679](https://github.com/Owloops/browserbird/commit/4e976792ac1f38e4ad5ba619163daa52cc482ae1))

## [1.4.16](https://github.com/Owloops/browserbird/compare/v1.4.15...v1.4.16) (2026-03-14)


### Bug Fixes

* **provider:** remove opencode provider and provider abstraction ([#6](https://github.com/Owloops/browserbird/issues/6)) ([b807d93](https://github.com/Owloops/browserbird/commit/b807d937b0d78743f9de1d49acfe9cc32165fe4f))

## [1.4.15](https://github.com/Owloops/browserbird/compare/v1.4.14...v1.4.15) (2026-03-12)


### Bug Fixes

* **slack:** resolve channel names against live config on reload ([d1793a3](https://github.com/Owloops/browserbird/commit/d1793a3eaee8e6d63526c28dcdca1e3598d384a9))

## [1.4.14](https://github.com/Owloops/browserbird/compare/v1.4.13...v1.4.14) (2026-03-12)


### Bug Fixes

* **container:** add agent cli deny rules for destructive sudo commands ([b382416](https://github.com/Owloops/browserbird/commit/b38241676b0cfb906f92f85c02adcfc544353f75))

## [1.4.13](https://github.com/Owloops/browserbird/compare/v1.4.12...v1.4.13) (2026-03-12)


### Bug Fixes

* **slack:** validate token prefixes before connecting and allow retry on failure ([378d698](https://github.com/Owloops/browserbird/commit/378d6983064be8a4ec44ad5e090f8f80f3d7d7b3))

## [1.4.12](https://github.com/Owloops/browserbird/compare/v1.4.11...v1.4.12) (2026-03-12)


### Bug Fixes

* **slack:** remove unused session stop button and action handler ([9ce27c3](https://github.com/Owloops/browserbird/commit/9ce27c33ca3c62231037856099c6df9e5e166577))
* **vm:** use playwright-bundled chrome for manual browser launch ([931ed3f](https://github.com/Owloops/browserbird/commit/931ed3fe208ff0a63441d1c49aa8cca77ef80723))

## [1.4.11](https://github.com/Owloops/browserbird/compare/v1.4.10...v1.4.11) (2026-03-11)


### Bug Fixes

* **slack:** restore eager stream creation for realtime delta streaming ([afb8a9c](https://github.com/Owloops/browserbird/commit/afb8a9cd1a061c41a693ba7afab3c7c68dddb413))

## [1.4.10](https://github.com/Owloops/browserbird/compare/v1.4.9...v1.4.10) (2026-03-11)


### Bug Fixes

* **vm:** use correct gl and gpu flags to prevent chromium crash in container ([f7951d5](https://github.com/Owloops/browserbird/commit/f7951d573d695e4d7e43452fd8ef6b150828b63b))

## [1.4.9](https://github.com/Owloops/browserbird/compare/v1.4.8...v1.4.9) (2026-03-11)


### Bug Fixes

* **vm:** revert sway resolution to 1280x720 ([b7c5b93](https://github.com/Owloops/browserbird/commit/b7c5b9354ed71dfec364a7b532b34a84cd3fa3d2))

## [1.4.8](https://github.com/Owloops/browserbird/compare/v1.4.7...v1.4.8) (2026-03-11)


### Bug Fixes

* **slack:** defer stream creation to keep thinking status visible ([f527025](https://github.com/Owloops/browserbird/commit/f527025a836211425b6b415f8518f0fbeb18e39a))
* **vm:** set sway resolution to 1920x1080 ([9201c05](https://github.com/Owloops/browserbird/commit/9201c051a7435e6c942b52adcfd897a7272c8b81))

## [1.4.7](https://github.com/Owloops/browserbird/compare/v1.4.6...v1.4.7) (2026-03-11)


### Bug Fixes

* **vm:** restore dbus-launch with env file, add crash reporter flag, revert resolution, remove unused build args ([5806f4b](https://github.com/Owloops/browserbird/commit/5806f4bdd4515f52eae5bf576cb97fa1e32bf2f1))

## [1.4.6](https://github.com/Owloops/browserbird/compare/v1.4.5...v1.4.6) (2026-03-11)


### Bug Fixes

* **vm:** revert ss back to netstat in novnc wait loop ([a189e73](https://github.com/Owloops/browserbird/commit/a189e73ec8ee3ec06b6208d4ddf195925dda4bb9))

## [1.4.5](https://github.com/Owloops/browserbird/compare/v1.4.4...v1.4.5) (2026-03-11)


### Bug Fixes

* **vm:** fix manual chromium crash and improve process management ([f4bc842](https://github.com/Owloops/browserbird/commit/f4bc842b65499225705fc0f4239dc5a6cd6ba131))

## [1.4.4](https://github.com/Owloops/browserbird/compare/v1.4.3...v1.4.4) (2026-03-11)


### Bug Fixes

* **slack:** handle streaming expiry, timeout retry button, and session stop ([375bdde](https://github.com/Owloops/browserbird/commit/375bddeed3d924b80bab61dff759ab031fdb3201))

## [1.4.3](https://github.com/Owloops/browserbird/compare/v1.4.2...v1.4.3) (2026-03-11)


### Bug Fixes

* **app:** add fontconfig explicitly for resvg font discovery ([ac29c6e](https://github.com/Owloops/browserbird/commit/ac29c6ef3291c3a780f22631a2fcf22a7adb3fef))

## [1.4.2](https://github.com/Owloops/browserbird/compare/v1.4.1...v1.4.2) (2026-03-11)


### Bug Fixes

* **app:** install comfortaa font for repocard rendering ([f6a42fa](https://github.com/Owloops/browserbird/commit/f6a42fafa0c1579a02218396225be1f54c24a261))

## [1.4.1](https://github.com/Owloops/browserbird/compare/v1.4.0...v1.4.1) (2026-03-11)


### Bug Fixes

* **vm:** allow playwright-mcp unrestricted file access for uploads ([7d425f2](https://github.com/Owloops/browserbird/commit/7d425f2d9d473bfa44347e9bdd1e636409b2191f))

# [1.4.0](https://github.com/Owloops/browserbird/compare/v1.3.5...v1.4.0) (2026-03-11)


### Features

* **vm:** add file server for cross-container file transfer to browser ([21388fc](https://github.com/Owloops/browserbird/commit/21388fc75d7c7d2d07d37ba6d6c21b52eb753c45))

## [1.3.5](https://github.com/Owloops/browserbird/compare/v1.3.4...v1.3.5) (2026-03-11)


### Bug Fixes

* **agent-context:** add repocard and lastgen to tools section ([154697c](https://github.com/Owloops/browserbird/commit/154697cdd9182c429331fba77a21d8ba35d708b5))

## [1.3.4](https://github.com/Owloops/browserbird/compare/v1.3.3...v1.3.4) (2026-03-10)


### Bug Fixes

* use config getter for live config reload without restart ([f239d89](https://github.com/Owloops/browserbird/commit/f239d892bb040418ad100b83135df7e5442acfef))

## [1.3.3](https://github.com/Owloops/browserbird/compare/v1.3.2...v1.3.3) (2026-03-10)


### Bug Fixes

* **vm:** migrate container process management to supervisord ([4fe7ef5](https://github.com/Owloops/browserbird/commit/4fe7ef5737cbfc42537f98c7e715101349405dfa))

## [1.3.2](https://github.com/Owloops/browserbird/compare/v1.3.1...v1.3.2) (2026-03-10)


### Bug Fixes

* **db:** reduce database open/close logs to debug level ([b988614](https://github.com/Owloops/browserbird/commit/b988614f7a3ea9de8254a807ad3497d37e6441e7))

## [1.3.1](https://github.com/Owloops/browserbird/compare/v1.3.0...v1.3.1) (2026-03-10)


### Bug Fixes

* **agent-context:** remove stale --timezone flag and update slack-optional framing ([7a38fde](https://github.com/Owloops/browserbird/commit/7a38fde28b18642c0e6dbfe7c7221777ed34033b))

# [1.3.0](https://github.com/Owloops/browserbird/compare/v1.2.11...v1.3.0) (2026-03-09)


### Features

* **daemon:** make slack optional with progressive activation ([b06564a](https://github.com/Owloops/browserbird/commit/b06564aa22755ababe5972e05230d453baa632e9))

## [1.2.11](https://github.com/Owloops/browserbird/compare/v1.2.10...v1.2.11) (2026-03-09)


### Bug Fixes

* **settings:** add per-agent process timeout with global fallback ([a5c7846](https://github.com/Owloops/browserbird/commit/a5c784646077ea93f574e3557dbcb4126981c868))

## [1.2.10](https://github.com/Owloops/browserbird/compare/v1.2.9...v1.2.10) (2026-03-09)


### Bug Fixes

* **daemon:** defer env resolution until slack tokens are confirmed ([bddda22](https://github.com/Owloops/browserbird/commit/bddda226a98294fa5e272a0f50b3e8f52dab935f))

## [1.2.9](https://github.com/Owloops/browserbird/compare/v1.2.8...v1.2.9) (2026-03-09)


### Bug Fixes

* **handler:** always show timeout block when session times out ([c3481c8](https://github.com/Owloops/browserbird/commit/c3481c8e048a6121f0a2c6cd163cf61863ca5d9d))

## [1.2.8](https://github.com/Owloops/browserbird/compare/v1.2.7...v1.2.8) (2026-03-06)


### Bug Fixes

* post slack block when agent session times out ([#5](https://github.com/Owloops/browserbird/issues/5)) ([a5294d8](https://github.com/Owloops/browserbird/commit/a5294d87d4c94fa7527751eea09349373839b7cd))

## [1.2.7](https://github.com/Owloops/browserbird/compare/v1.2.6...v1.2.7) (2026-03-06)


### Bug Fixes

* **browser:** acquire browser lock lazily on first playwright tool use ([febb9bb](https://github.com/Owloops/browserbird/commit/febb9bb9f678ef12c57880b663dcc875288f1950))
* clear stale browser lock on startup and remove chrome singletonlock on vm boot ([437d13d](https://github.com/Owloops/browserbird/commit/437d13df3c27bdb7911a5a04ab8556de55c6c48b))
* use global config timezone instead of per-bird timezone ([20fe26a](https://github.com/Owloops/browserbird/commit/20fe26aaad097236ba9495b384239d5dc6f766cc))

## [1.2.6](https://github.com/Owloops/browserbird/compare/v1.2.5...v1.2.6) (2026-03-05)


### Bug Fixes

* **claude:** persist session state across container restarts ([536f400](https://github.com/Owloops/browserbird/commit/536f400d5d95ecfb7467a216235dcdd8e7d9573f))

## [1.2.5](https://github.com/Owloops/browserbird/compare/v1.2.4...v1.2.5) (2026-03-05)


### Bug Fixes

* **browser:** add sqlite-based lock for persistent browser mode ([c472ad8](https://github.com/Owloops/browserbird/commit/c472ad836f230a79dd3d4dbbfd792c2feab168a6))
* **cli:** support BROWSERBIRD_CONFIG env var in config command ([96f0072](https://github.com/Owloops/browserbird/commit/96f00723e8025ffe03ab3ee022ae1c61089351de))
* format files with prettier ([6c46374](https://github.com/Owloops/browserbird/commit/6c46374ad2f83536a49768a46c02b8a043b1304a))

## [1.2.4](https://github.com/Owloops/browserbird/compare/v1.2.3...v1.2.4) (2026-03-05)


### Bug Fixes

* add use cases section to readme ([e70043f](https://github.com/Owloops/browserbird/commit/e70043fd3f928c23a5fd3728b655509809d9b0b5))

## [1.2.3](https://github.com/Owloops/browserbird/compare/v1.2.2...v1.2.3) (2026-03-04)


### Bug Fixes

* **config:** support env-var deployment and instance-specific context ([0789c78](https://github.com/Owloops/browserbird/commit/0789c789204818ca82eb00935f85a813bf37c985))

## [1.2.2](https://github.com/Owloops/browserbird/compare/v1.2.1...v1.2.2) (2026-03-03)


### Bug Fixes

* **vm:** use persistent browser profile for manual chromium launches ([18c3c2c](https://github.com/Owloops/browserbird/commit/18c3c2cb5ab30bc235d539126ed922c178f6a01b))

## [1.2.1](https://github.com/Owloops/browserbird/compare/v1.2.0...v1.2.1) (2026-03-03)


### Bug Fixes

* **vm:** fix browser profile volume permissions via gosu ([159f561](https://github.com/Owloops/browserbird/commit/159f5613908026526a36f40c9389342e4edd85c3))

# [1.2.0](https://github.com/Owloops/browserbird/compare/v1.1.6...v1.2.0) (2026-03-03)


### Features

* **web:** auto-detect railway and prepopulate vm host in onboarding ([332472f](https://github.com/Owloops/browserbird/commit/332472f9a3de3cff319a6334baf06b8b50cd0f42))

## [1.1.6](https://github.com/Owloops/browserbird/compare/v1.1.5...v1.1.6) (2026-03-03)


### Bug Fixes

* **readme:** update railway deploy button to new template url ([d968d8c](https://github.com/Owloops/browserbird/commit/d968d8cda4b67fafb161ec2519117ef0c81759a5))

## [1.1.5](https://github.com/Owloops/browserbird/compare/v1.1.4...v1.1.5) (2026-03-03)


### Bug Fixes

* **vm:** persist browser profile across container restarts ([562f88c](https://github.com/Owloops/browserbird/commit/562f88c4f4141914972eec4f24fc8d1690b0a647))
* **web:** add unauthenticated healthcheck endpoint for railway ([c9b5494](https://github.com/Owloops/browserbird/commit/c9b5494d6e5a7f575a4e3a9f1634acb8586253f4))

## [1.1.4](https://github.com/Owloops/browserbird/compare/v1.1.3...v1.1.4) (2026-03-02)


### Bug Fixes

* **docs:** add another video showcase ([9a26d64](https://github.com/Owloops/browserbird/commit/9a26d64771305792754153472ab1739d842aa17c))

## [1.1.3](https://github.com/Owloops/browserbird/compare/v1.1.2...v1.1.3) (2026-03-02)


### Bug Fixes

* **birds:** post full result to slack and log tokens to db ([4634fde](https://github.com/Owloops/browserbird/commit/4634fdee3b4c3e6ca054b877b09dec5492ad9733))
* **slack:** add tip about duplicate slash command registrations ([f081ab6](https://github.com/Owloops/browserbird/commit/f081ab626328b4a00907de0601e2a81929c35567))

## [1.1.2](https://github.com/Owloops/browserbird/compare/v1.1.1...v1.1.2) (2026-03-02)


### Bug Fixes

* **readme:** simplify installation, slack setup, and badges ([44a214e](https://github.com/Owloops/browserbird/commit/44a214eeeb50c50b552a00a0ab672c9cd3458e99))

## [1.1.1](https://github.com/Owloops/browserbird/compare/v1.1.0...v1.1.1) (2026-03-02)


### Bug Fixes

* **web:** lower vnc quality level from 8 to 7 to reduce lag ([6073adb](https://github.com/Owloops/browserbird/commit/6073adb05cd2e7b877031d51b2b49c66615ce5ab))

# [1.1.0](https://github.com/Owloops/browserbird/compare/v1.0.11...v1.1.0) (2026-03-01)


### Features

* **vm:** add light browser stealth to reduce automation detection ([57cbbe3](https://github.com/Owloops/browserbird/commit/57cbbe31864d1a5544fb76e5004e20af5cb302eb))

## [1.0.11](https://github.com/Owloops/browserbird/compare/v1.0.10...v1.0.11) (2026-03-01)


### Bug Fixes

* **mcp:** auto-generate mcp config from browser host instead of static file ([319d699](https://github.com/Owloops/browserbird/commit/319d6990795fcfce2a7df3f53b47d02c0b2af95e))

## [1.0.10](https://github.com/Owloops/browserbird/compare/v1.0.9...v1.0.10) (2026-03-01)


### Bug Fixes

* **config:** store .env next to config file so secrets persist on mounted volumes ([9c7ef13](https://github.com/Owloops/browserbird/commit/9c7ef137338d68784026100854c6493c2dbe0921))
* formatting in routes.ts ([32c794e](https://github.com/Owloops/browserbird/commit/32c794e0d9ef0359a278ff184486621ac313e8ae))
* **vm:** add --disable-dev-shm-usage to prevent chromium crashes in constrained containers ([2c7cc0e](https://github.com/Owloops/browserbird/commit/2c7cc0e2def0be43c68503d80999e6ce978ec73a))


### Performance Improvements

* **web:** increase vnc quality level to 8 for sharper remote display ([9b8a5bb](https://github.com/Owloops/browserbird/commit/9b8a5bb5931695a180fb40c4afc509192b1710aa))

## [1.0.9](https://github.com/Owloops/browserbird/compare/v1.0.8...v1.0.9) (2026-03-01)


### Performance Improvements

* **vm:** reduce resolution to 720p and tune vnc quality for lower cpu usage ([52cba8b](https://github.com/Owloops/browserbird/commit/52cba8b240fcfea6d183adc4b5c414f36141e4de))

## [1.0.8](https://github.com/Owloops/browserbird/compare/v1.0.7...v1.0.8) (2026-03-01)


### Bug Fixes

* **docker:** use gosu to fix volume permissions on platforms with root-owned mounts ([6ae7c7b](https://github.com/Owloops/browserbird/commit/6ae7c7b042b8052fee4080c9038e7b980cd1c63b))
* **vm:** use websockify directly for IPv6 dual-stack support ([0ddf871](https://github.com/Owloops/browserbird/commit/0ddf87184a7acba9c715b07304033b0f9de0825a))

## [1.0.7](https://github.com/Owloops/browserbird/compare/v1.0.6...v1.0.7) (2026-03-01)


### Bug Fixes

* **vm:** enable dual-stack listening for noVNC to support IPv6 networking ([05708f2](https://github.com/Owloops/browserbird/commit/05708f2a8c2fa219afdb74697f682824b610121b))

## [1.0.6](https://github.com/Owloops/browserbird/compare/v1.0.5...v1.0.6) (2026-03-01)


### Bug Fixes

* **health:** use live config for browser health checks after config reload ([21152d6](https://github.com/Owloops/browserbird/commit/21152d6635fcc0d319dec3532fee50c38dc42107))

## [1.0.5](https://github.com/Owloops/browserbird/compare/v1.0.4...v1.0.5) (2026-03-01)


### Bug Fixes

* **logger:** route log streams by mode for cloud platform compatibility ([586c182](https://github.com/Owloops/browserbird/commit/586c182ef205aa8aeb3b28c768ad78da04c3899b))

## [1.0.4](https://github.com/Owloops/browserbird/compare/v1.0.3...v1.0.4) (2026-03-01)


### Bug Fixes

* **ci:** native builds to speed up ci ([31deacf](https://github.com/Owloops/browserbird/commit/31deacfff288caf3ef7112dbf1077a0430fb74a6))
* **ci:** pass build env vars to semantic-release step ([060bed3](https://github.com/Owloops/browserbird/commit/060bed3142df6dad1803c73bcb31ad4cb7317abd))

## [1.0.3](https://github.com/Owloops/browserbird/compare/v1.0.2...v1.0.3) (2026-03-01)


### Bug Fixes

* **docker:** install devDependencies for backend build, prune after ([8508da3](https://github.com/Owloops/browserbird/commit/8508da3ffdb3230ea117b27463cc293726074f06))

## [1.0.2](https://github.com/Owloops/browserbird/compare/v1.0.1...v1.0.2) (2026-03-01)


### Bug Fixes

* **docker:** pre-create .browserbird directory for correct volume ownership ([3375915](https://github.com/Owloops/browserbird/commit/3375915fffda7f07d289e25e8ceb51bd692ad164))

## [1.0.1](https://github.com/Owloops/browserbird/compare/v1.0.0...v1.0.1) (2026-03-01)


### Bug Fixes

* **ci:** add multi-arch docker builds for amd64 and arm64 ([4ff9b60](https://github.com/Owloops/browserbird/commit/4ff9b602af8256b286ef646465015cb276bf0e4f))

# 1.0.0 (2026-03-01)


### Bug Fixes

* **channel:** downgrade rate limit event from warn to debug ([b746721](https://github.com/Owloops/browserbird/commit/b746721a5dd0f0add7b8577960933baa87c5ac2d))
* **cli:** remove "claude" from session help text ([ea0a13c](https://github.com/Owloops/browserbird/commit/ea0a13c7ade6349032c424363941142560fa7a10))
* **config:** reject fallbackModel equal to model at load time ([dc20ac5](https://github.com/Owloops/browserbird/commit/dc20ac587e74fbf80aebd4b5f17144323cf497f1))
* **config:** rename stale cron config to birds and track oci config ([57262af](https://github.com/Owloops/browserbird/commit/57262afb954a14593bf4ffcc68c4c8c0c3e48b2c))
* **cron:** evaluate schedules in per-bird timezone via Intl.DateTimeFormat ([bd7a873](https://github.com/Owloops/browserbird/commit/bd7a873b0e6c130521ba7ae6d518e86fbd1ee104))
* **cron:** harden scheduler with stale job cascade, active hours, and graceful parse errors ([79250c1](https://github.com/Owloops/browserbird/commit/79250c195aaace84853e8c873988252635f091b8))
* **cron:** increase bird result summary limit from 300 to 2800 chars ([5559c27](https://github.com/Owloops/browserbird/commit/5559c276a5fbeb7d0d1f1923ffd5eefbeae84746))
* **daemon:** pass block kit opts through postToSlack lambda ([d49ec0c](https://github.com/Owloops/browserbird/commit/d49ec0c4ef9dc15bed30bb2691b4de53736557a2))
* **docker:** fix mutter startup with XDG_SESSION_TYPE=x11, correct entrypoint order to mutter before tint2, retheme tint2 to dashboard palette, suppress git detachedHead advice ([5904384](https://github.com/Owloops/browserbird/commit/5904384411fcdc382ca8b154dbf5dd3999f4dc0e))
* **doctor:** strip parenthetical from cli version output ([7ce4b80](https://github.com/Owloops/browserbird/commit/7ce4b80a2108c98ceb26b2370e77f1f2eacd7b48))
* harden concurrency, validation, and resource cleanup ([227103d](https://github.com/Owloops/browserbird/commit/227103d83b0975518c8de9e3010aa2b9b9764d5e))
* **jobs:** track flights and status for system bird runs ([0a31aaa](https://github.com/Owloops/browserbird/commit/0a31aaa1b3c124a25cbfa2b462c6859136d5be68))
* **oci:** load config at startup so container overrides apply in setup mode ([8521f1e](https://github.com/Owloops/browserbird/commit/8521f1e62c2d862581364b8117b91737f671abd9))
* **oci:** persist config and database across container upgrades ([70909aa](https://github.com/Owloops/browserbird/commit/70909aa1b94348afc92e1a188ad890eb993f052c))
* **onboarding:** improve token validation, auto-detect key type, and streamline final step ([d05c758](https://github.com/Owloops/browserbird/commit/d05c758169ac4b7d61f3d1e38a1c31a7f773d91d))
* **provider:** opencode oci support, error parsing, and auth isolation ([0305622](https://github.com/Owloops/browserbird/commit/03056228aaf860d81b1e76349959cf38cf6174f7))
* **sessions:** correct message_count to reflect actual batch size and bot reply ([6f52893](https://github.com/Owloops/browserbird/commit/6f52893571bde23d7ec78666a8f9ab5582d80898))
* **slack:** enable app home messages tab and interactivity ([880bdf0](https://github.com/Owloops/browserbird/commit/880bdf09604ec189bf5531bc528bf7195098dea4))
* **status:** show active process count instead of db session count ([917e405](https://github.com/Owloops/browserbird/commit/917e405bb2942bdfb84d98dbb481129cebf9a8d1))
* **ui:** align sidebar brand and content header to same fixed height to flush border lines ([4f81e5d](https://github.com/Owloops/browserbird/commit/4f81e5d356d33004865bb42c2672ac2aca60e842))
* **web:** replace loading flicker with dim overlay during table refetch ([0785281](https://github.com/Owloops/browserbird/commit/0785281d4c1ca136bd55da2a26145f95687fc4c5))
* **web:** resolve type error in Birds flight history check ([b7dbbb7](https://github.com/Owloops/browserbird/commit/b7dbbb7d4cf2eb802c74f478436f7c2f487ca8e9))
* **web:** set browser tab title to current page name ([9fc1686](https://github.com/Owloops/browserbird/commit/9fc168614b7887179947c06e745fdf3520a38ccc))


### Features

* add cross-origin frontend deployment support ([404eb3c](https://github.com/Owloops/browserbird/commit/404eb3ce1becadcc5f4ae6db52cff4a448988d4f))
* add signout button ([480e802](https://github.com/Owloops/browserbird/commit/480e802fac5c64d28db3b8879e6ec270123fb454))
* **api:** add server-side sort and search to all list endpoints ([6d5ddc2](https://github.com/Owloops/browserbird/commit/6d5ddc2304a564fc5616740e0f21a4d8d44f6221))
* **auth:** add user db, password hashing, and token signing ([1bcfd1b](https://github.com/Owloops/browserbird/commit/1bcfd1b5c50d292de6ae270fc8be95b659e72791))
* **birds:** add inline flight history, remove jobs nav item ([128e849](https://github.com/Owloops/browserbird/commit/128e8492c27981fe62fbe13628d65910568d539f))
* **birds:** expose active hours via cli --active-hours flag and api ([822afaf](https://github.com/Owloops/browserbird/commit/822afafbd9b27ea38378f077d62a9ea2494951d7))
* **birds:** scheduled bird runner with circuit breaker, active hours, and cron/interval expression parser ([8089898](https://github.com/Owloops/browserbird/commit/80898988590e5e65f19cc872431654656cde02f7))
* **birds:** show last run age and status badge per row ([5807345](https://github.com/Owloops/browserbird/commit/58073458f4c03c359164e0d76fe6164405135e46))
* **browser:** add configurable browser mode (persistent/isolated) ([ca785db](https://github.com/Owloops/browserbird/commit/ca785db5e742c88e71fd93d4b2d1d683342225d7))
* **browser:** replace noVNC iframe with custom RFB viewer using @novnc/novnc 1.7.0-beta with clipboard, disconnect, and connection info popover ([be460d7](https://github.com/Owloops/browserbird/commit/be460d7a5908a7adffad7b558a76b71ba63fe51f))
* **channel:** add block kit cards and /bird slash commands ([d52c6e4](https://github.com/Owloops/browserbird/commit/d52c6e4246ce797b3ed2bf7894f9f15ffd31033e))
* **channel:** platform-agnostic channel interface with slack adapter, message coalescing, dedup, and streaming response handler ([5d70218](https://github.com/Owloops/browserbird/commit/5d7021812e6a75696039c4e531d3a61833f7637c))
* **channel:** update slack and scheduler for string uids ([2fdccbb](https://github.com/Owloops/browserbird/commit/2fdccbbb7c583ff81590d3284c07b6ec39c3c73c))
* **ci:** add release automation, pre-built docker compose, and publish gates ([085cbba](https://github.com/Owloops/browserbird/commit/085cbbae442383deb09528d5e384fda60715f47a))
* **cli:** add --db flag and BROWSERBIRD_DB env var for database path ([14aae2b](https://github.com/Owloops/browserbird/commit/14aae2b2d621356d553afae6e982da7feca61388))
* **cli:** add ascii bird banner to help and daemon startup ([25dddd9](https://github.com/Owloops/browserbird/commit/25dddd91b0286d71588598226cd89a4f32505b4e))
* **cli:** add color to help text, tables, and command output ([30a1e99](https://github.com/Owloops/browserbird/commit/30a1e992f21627cc17251d8ff55f8471cd97f0e1))
* **cli:** add hints, typo correction, startup progress, and --json output ([682158d](https://github.com/Owloops/browserbird/commit/682158d49ac82c7b3a6a7ce0f2f35228f78b0344))
* **cli:** command routing for sessions, birds, jobs, and db with daemon orchestrator and graceful shutdown ([0b5e911](https://github.com/Owloops/browserbird/commit/0b5e911a73c216a0f42d9f5fabf9bdf16a2ce6f4))
* **cli:** update birds and sessions commands for uid lookups ([25dc118](https://github.com/Owloops/browserbird/commit/25dc1189bd58c5f45c8ab8e55289df458dc9c489))
* **config:** add config read/write and env file helpers ([c5efa05](https://github.com/Owloops/browserbird/commit/c5efa05ce2fa53686db632dd81b7e58db613b127))
* **config:** add top-level timezone as default for new birds ([5f91bdd](https://github.com/Owloops/browserbird/commit/5f91bdd92247025ff7c1b74ed1d15b9966404c0b))
* **core:** sqlite db with migrations, env-aware config loading, structured logger, and metrics counters ([d244ebd](https://github.com/Owloops/browserbird/commit/d244ebd83c3d57769d4ccb9f1d7a50f4b75496ed))
* **cron:** add block kit cards and rate limit handling to bird runs ([c48c978](https://github.com/Owloops/browserbird/commit/c48c978d10281229f9e405bd7915221e8152335d))
* **daemon:** support deferred start for setup mode ([7f04dd2](https://github.com/Owloops/browserbird/commit/7f04dd292a4cc25b30d1752d6b2b812fa7d21e3b))
* **db:** add uid generation and prefix-match resolution ([1a78f58](https://github.com/Owloops/browserbird/commit/1a78f5855657ed390e11d03e78c5700450b6df77))
* **db:** migrate birds, sessions, and jobs to string uids ([895c918](https://github.com/Owloops/browserbird/commit/895c918aa32ef1fea9fe33e719d071bfc4aefad0))
* **docker:** single-container browser stack with xvfb, mutter, x11vnc, novnc, and playwright mcp ([81c7147](https://github.com/Owloops/browserbird/commit/81c714708f5adde3e0d46ebf9057276b7d473954))
* **flights:** add cron_runs tracking and /api/flights endpoint ([0d5697b](https://github.com/Owloops/browserbird/commit/0d5697b74b3ab75c3085e3224c590ff565652b80))
* **jobs:** sqlite-backed job queue with exponential backoff and stale job recovery ([4e546d7](https://github.com/Owloops/browserbird/commit/4e546d7f7191ec913e2244d1efb3825cab5a61f5))
* **manifest:** add assistant view, slash commands, and new scopes ([5b9a805](https://github.com/Owloops/browserbird/commit/5b9a80561ad8cf268a0595cf4f0961ff9892f416))
* **oci:** 1080p resolution with scaled-up ui for vnc readability ([549f2df](https://github.com/Owloops/browserbird/commit/549f2dfe1bbf9bd2b5c7849f32e3df3174796f24))
* **provider:** add opencode as second agent cli provider ([b1afba0](https://github.com/Owloops/browserbird/commit/b1afba03efd8115d1b6ec0e88398cb4d5cc5d417))
* **provider:** claude cli spawner with stream-json parsing, async iterable bridge, and thread-to-session router ([99d9c54](https://github.com/Owloops/browserbird/commit/99d9c549c7a39dd71233cffbb579c18f3e1d446b))
* **retry:** wire up slack error retry button and add retry to flights page ([f8817aa](https://github.com/Owloops/browserbird/commit/f8817aa74bf55c12215d108700093bd077f6527f))
* **security:** add output redaction for agent text and errors ([49db868](https://github.com/Owloops/browserbird/commit/49db868198675a2f63d46b39345bc090564e2c87))
* **server:** add PATCH /api/config endpoint with validation and live reload ([050358c](https://github.com/Owloops/browserbird/commit/050358c40e3b8fcf4b8d5650c764e5ea7c5153b2))
* **server:** add secrets API for viewing and updating env credentials ([f2ce0ea](https://github.com/Owloops/browserbird/commit/f2ce0ea69d942766d659ebbe326642835b076ee7))
* **server:** node:http rest api with sse realtime stream, token auth, and static file serving ([423f043](https://github.com/Owloops/browserbird/commit/423f0439335b77907484115f41a99ecce720a92f))
* **server:** proxy vnc websocket through the main http server ([55c677e](https://github.com/Owloops/browserbird/commit/55c677ef8a4ace9339c7b58dee74dc448687ec3a))
* **server:** rewrite auth middleware and add setup/login endpoints ([34a86bd](https://github.com/Owloops/browserbird/commit/34a86bd48849b58b8b246bed567402e77e222156))
* **server:** update api routes for uid-based bird resolution ([1bb2012](https://github.com/Owloops/browserbird/commit/1bb201216a5a880ec8a8ef769fa2f20d3c77e56c))
* **sessions:** add session inspector endpoint, web ui, and cli command ([597f83e](https://github.com/Owloops/browserbird/commit/597f83ef3b4324efe66f6ec6c201d758e703e2c5))
* **slack:** add requireMention config to restrict channel responses to [@mentions](https://github.com/mentions) ([2f5d199](https://github.com/Owloops/browserbird/commit/2f5d1992e3c17c97834e96ca4a3e1c69a5356253))
* **sse:** replace polling with targeted invalidation events ([517302e](https://github.com/Owloops/browserbird/commit/517302eab03b397938063cb4ba1d043b4de35260))
* **web:** add aggregate service status indicator with health checks ([a92b1ea](https://github.com/Owloops/browserbird/commit/a92b1ea8d16728afa3ce56345f0f69450623d80e))
* **web:** add collapsible sidebar with localStorage persistence ([3442501](https://github.com/Owloops/browserbird/commit/3442501e00812e647bd231cd24c672d7bcd14b7b))
* **web:** add data table composable with sort, search, and pagination ([46fd7f4](https://github.com/Owloops/browserbird/commit/46fd7f4b6dfa9b8550d024d44f73b657e97ea1df))
* **web:** add flights page with filters, sort, and expandable rows ([39ca4f4](https://github.com/Owloops/browserbird/commit/39ca4f4b6d84b1b4b5904e6070b5b706f6759d22))
* **web:** add inline secrets editing to settings page ([d9061a7](https://github.com/Owloops/browserbird/commit/d9061a73597c442c42025617c4bd048a2d441d5b))
* **web:** add last-updated timestamp to flights, sessions, and session detail pages ([8afaeee](https://github.com/Owloops/browserbird/commit/8afaeeef63e8b218cbed0c190f3acf0f8efd1c5b))
* **web:** add mobile responsiveness across all pages and components ([2ec9e07](https://github.com/Owloops/browserbird/commit/2ec9e0782e3aefc216a4d99487ca91bdb6939c67))
* **web:** add onboarding wizard with multi-step setup flow ([53e8451](https://github.com/Owloops/browserbird/commit/53e84519e094ede5fc8605073434f08f659de445))
* **web:** add recent flights section to dashboard ([dd57a8e](https://github.com/Owloops/browserbird/commit/dd57a8edaf523d7cad36728b0abf7e8cc9e110cc))
* **web:** add system flights toggle and protect system birds ([e4fae98](https://github.com/Owloops/browserbird/commit/e4fae98266acf453a1f0ebdd4ee0f7c167e058b9))
* **web:** inline cell editing for birds, link flights instead of embedding ([61593dc](https://github.com/Owloops/browserbird/commit/61593dc6e85936284519de99de6a140dec8dfa6b))
* **web:** lazy-load doctor and show agent cli as pill badges ([19a6fe0](https://github.com/Owloops/browserbird/commit/19a6fe0dfbe7c956333761d83f3923b75394b5c3))
* **web:** max vnc quality with no compression in browser viewer ([3c1cfcc](https://github.com/Owloops/browserbird/commit/3c1cfcc65f0c337e7a36b000eb1d4fd355d22856))
* **web:** migrate frontend to string uids with filter chip and channel column ([d8ffca2](https://github.com/Owloops/browserbird/commit/d8ffca21054afc8e93f4b65b7cf5b4c39c0062cf))
* **web:** onboarding flow and browser page improvements ([16ba0e2](https://github.com/Owloops/browserbird/commit/16ba0e207744270693ec349ea9a2d3120ee425e2))
* **web:** redesign status header with pill indicators and stat cards ([b273ebf](https://github.com/Owloops/browserbird/commit/b273ebfa7e801cff2a1e125a41eb6b923c09fa68))
* **web:** redesign status page with service health, next-up, and failing birds ([9061ede](https://github.com/Owloops/browserbird/commit/9061ede11e85a3bd03b687ecb0a59eeb5ea7ec39))
* **web:** replace flights page with bird drawer overlay ([f177a94](https://github.com/Owloops/browserbird/commit/f177a945bfc48ae5dc73340515bd6c2c0377075d))
* **web:** replace token input with email+password auth flow ([41c307b](https://github.com/Owloops/browserbird/commit/41c307b712363f4c6fef5cf01b61a7f5cb35c2e0))
* **web:** svelte 5 spa with dashboard, sessions, birds, jobs, logs, browser, and settings pages ([5890fb3](https://github.com/Owloops/browserbird/commit/5890fb308f4697520d4a3151a5f36ec5f064435b))
