(function () {
  var storageRootPrefix = "offline_singleplayer:";
  var activeSlotId = null;
  var offlineInitialized = false;
  var bootGateState = {
    ready: false,
    actualBoot: null,
    pendingArgs: null,
    installed: false,
  };
  var oneDayMs = 24 * 60 * 60 * 1000;
  var installTimer = null;
  var offlineNoticeText = "单机版不支持联网功能";
  var adRewardDisabledNoticeText = "单机版暂时关闭广告奖励，页面流程会继续但不发奖";
  var offlineConfig = {
    adRewardsEnabled: false,
    testSaveEnabled: true,
    testSaveChapter: 10,
    testSaveResourceFloor: {
      gold: 200000,
      diamond: 3000,
      energy: 200,
      exp: 4000,
    },
    maxLogs: 20,
    debugPanelVisible: false,
    saveSlotCount: 3,
  };
  var runtimeState = {
    logs: [],
    patchState: {},
    pendingRewardBlock: null,
    debugPanel: null,
    debugBody: null,
    debugVisible: false,
    debugInstalled: false,
    cornerTapCount: 0,
    cornerTapUntil: 0,
    lastTestSaveSignature: "",
    saveSelector: null,
    saveSelectorBody: null,
  };

  function getManagerStorageKey() {
    return storageRootPrefix + "save-manager";
  }

  function getSlotStoragePrefix(slotId) {
    return storageRootPrefix + "slot:" + slotId + ":";
  }

  function getActiveStoragePrefix() {
    var slotId = activeSlotId || "slot-1";
    return getSlotStoragePrefix(slotId);
  }

  function now() {
    return Date.now();
  }

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function nextResetAt() {
    var date = new Date();
    date.setHours(24, 0, 0, 0);
    return date.getTime();
  }

  function msUntilNextReset() {
    return Math.max(0, nextResetAt() - now());
  }

  function isDebugQueryEnabled() {
    try {
      return !!(window.location && /(?:^|[?&])debug=1(?:&|$)/.test(window.location.search || ""));
    } catch (err) {
      return false;
    }
  }

  function formatClockTime(timestamp) {
    try {
      return new Date(timestamp).toLocaleTimeString("zh-CN", { hour12: false });
    } catch (err) {
      return String(timestamp);
    }
  }

  function trimText(value, maxLength) {
    var text = value == null ? "" : String(value);
    return text.length > maxLength ? text.slice(0, maxLength - 1) + "…" : text;
  }

  function formatDateTime(timestamp) {
    if (!timestamp) return "未进入";
    try {
      return new Date(timestamp).toLocaleString("zh-CN", {
        hour12: false,
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (err) {
      return "未进入";
    }
  }

  function parseJson(raw, fallback) {
    try {
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      return fallback;
    }
  }

  function loadRootJson(key, fallback) {
    try {
      return parseJson(localStorage.getItem(storageRootPrefix + key), fallback);
    } catch (err) {
      console.warn("offline loadRootJson failed", key, err);
      return fallback;
    }
  }

  function saveRootJson(key, value) {
    try {
      localStorage.setItem(storageRootPrefix + key, JSON.stringify(value));
    } catch (err) {
      console.warn("offline saveRootJson failed", key, err);
    }
  }

  function getSlotIds() {
    var ids = [];
    for (var index = 1; index <= offlineConfig.saveSlotCount; index += 1) {
      ids.push("slot-" + index);
    }
    return ids;
  }

  function getSlotLabel(slotId) {
    var num = Number(String(slotId || "").split("-")[1] || 1);
    return "进度" + num;
  }

  function createDefaultSlotMeta(slotId) {
    return {
      id: slotId,
      name: getSlotLabel(slotId),
      used: false,
      createdAt: 0,
      updatedAt: 0,
      chapter: offlineConfig.testSaveEnabled ? offlineConfig.testSaveChapter : 1,
      stageName: offlineConfig.testSaveEnabled ? "测试进度" : "新手开局",
    };
  }

  function hasLegacyOfflineKeys() {
    var legacyKeys = ["profile", "sign", "daily-task", "online-box", "shop", "mail"];
    try {
      for (var i = 0; i < legacyKeys.length; i += 1) {
        if (localStorage.getItem(storageRootPrefix + legacyKeys[i]) != null) {
          return true;
        }
      }
    } catch (err) {}
    return false;
  }

  function slotHasScopedData(slotId) {
    var prefix = getSlotStoragePrefix(slotId);
    try {
      for (var i = 0; i < localStorage.length; i += 1) {
        var key = localStorage.key(i);
        if (key && key.indexOf(prefix) === 0) {
          return true;
        }
      }
    } catch (err) {}
    return false;
  }

  function migrateLegacyOfflineDataToSlot(slotId) {
    var legacyKeys = ["profile", "sign", "daily-task", "online-box", "shop", "mail"];
    var slotPrefix = getSlotStoragePrefix(slotId);
    var migrated = false;
    try {
      legacyKeys.forEach(function (key) {
        var raw = localStorage.getItem(storageRootPrefix + key);
        if (raw != null && localStorage.getItem(slotPrefix + key) == null) {
          localStorage.setItem(slotPrefix + key, raw);
          migrated = true;
        }
      });
    } catch (err) {
      console.warn("offline migrateLegacyOfflineDataToSlot failed", slotId, err);
    }
    return migrated;
  }

  function ensureSaveManager() {
    var manager = loadRootJson("save-manager", null);
    var changed = false;
    if (!manager || typeof manager !== "object" || !manager.slots) {
      manager = {
        currentSlotId: "slot-1",
        slots: {},
        migratedLegacy: false,
      };
      changed = true;
    }

    getSlotIds().forEach(function (slotId) {
      if (!manager.slots[slotId]) {
        manager.slots[slotId] = createDefaultSlotMeta(slotId);
        changed = true;
      }
      if (slotHasScopedData(slotId) && !manager.slots[slotId].used) {
        manager.slots[slotId].used = true;
        manager.slots[slotId].createdAt = manager.slots[slotId].createdAt || now();
        manager.slots[slotId].updatedAt = manager.slots[slotId].updatedAt || now();
        changed = true;
      }
    });

    if (!manager.currentSlotId || !manager.slots[manager.currentSlotId]) {
      manager.currentSlotId = "slot-1";
      changed = true;
    }

    if (!manager.migratedLegacy && hasLegacyOfflineKeys() && !slotHasScopedData("slot-1")) {
      if (migrateLegacyOfflineDataToSlot("slot-1")) {
        manager.slots["slot-1"].used = true;
        manager.slots["slot-1"].createdAt = manager.slots["slot-1"].createdAt || now();
        manager.slots["slot-1"].updatedAt = now();
        changed = true;
      }
      manager.migratedLegacy = true;
      changed = true;
    }

    if (changed) {
      saveRootJson("save-manager", manager);
    }
    return manager;
  }

  function updateSlotMeta(slotId, patch) {
    var manager = ensureSaveManager();
    var slot = manager.slots[slotId] || createDefaultSlotMeta(slotId);
    var next = patch || {};
    Object.keys(next).forEach(function (key) {
      slot[key] = next[key];
    });
    manager.slots[slotId] = slot;
    saveRootJson("save-manager", manager);
    return slot;
  }

  function updateActiveSlotMeta(patch) {
    if (!activeSlotId) return null;
    return updateSlotMeta(activeSlotId, patch);
  }

  function clearSlotData(slotId) {
    var prefix = getSlotStoragePrefix(slotId);
    var toRemove = [];
    try {
      for (var i = 0; i < localStorage.length; i += 1) {
        var key = localStorage.key(i);
        if (key && key.indexOf(prefix) === 0) {
          toRemove.push(key);
        }
      }
      toRemove.forEach(function (key) {
        localStorage.removeItem(key);
      });
    } catch (err) {
      console.warn("offline clearSlotData failed", slotId, err);
    }
  }

  function getSlotSummaryText(slot) {
    if (!slot || !slot.used) {
      return offlineConfig.testSaveEnabled ? "新建后进入第" + offlineConfig.testSaveChapter + "章测试档" : "空存档";
    }
    return "第" + (slot.chapter || 1) + "章 / " + (slot.stageName || "待进入");
  }

  function markActiveSlotUsed() {
    if (!activeSlotId) return;
    var manager = ensureSaveManager();
    var slot = manager.slots[activeSlotId] || createDefaultSlotMeta(activeSlotId);
    updateActiveSlotMeta({
      used: true,
      createdAt: slot.createdAt || now(),
      updatedAt: now(),
    });
  }

  function setActiveSlot(slotId) {
    var manager = ensureSaveManager();
    activeSlotId = slotId;
    manager.currentSlotId = slotId;
    var slot = manager.slots[slotId] || createDefaultSlotMeta(slotId);
    var currentTime = now();
    slot.createdAt = slot.createdAt || currentTime;
    slot.updatedAt = currentTime;
    if (!slot.used && !slotHasScopedData(slotId)) {
      slot.stageName = offlineConfig.testSaveEnabled ? "测试进度" : "新手开局";
      slot.chapter = offlineConfig.testSaveEnabled ? offlineConfig.testSaveChapter : 1;
    }
    manager.slots[slotId] = slot;
    saveRootJson("save-manager", manager);
    return slot;
  }

  function getScopedUserDataKey(key) {
    return getActiveStoragePrefix() + "userdata:" + key;
  }

  function snapshotPatchState() {
    var patchState = runtimeState.patchState;
    patchState.net = !!(window.net && window.net.__offlineSingleplayerPatched);
    patchState.sdk = !!(window.sdk && window.sdk.__offlineSingleplayerPatched);
    patchState.nativeSdk = !!(window.nativeSdk && window.nativeSdk.__offlineSingleplayerPatched);
    patchState.user = !!(window.user && window.user.__offlineSingleplayerPatched);
    patchState.task = !!(window.task && window.task.__offlineSingleplayerPatched);
    patchState.shop = !!(window.shop && window.shop.__offlineSingleplayerPatched);
    patchState.social = !!(window.hg && window.hg.__offlineSingleplayerPatched);
    patchState.pvp = !!(
      !(window.pvp || safeRequire("pvp")) || (window.pvp || safeRequire("pvp")).__offlineSingleplayerPatched
    );
    patchState.quickMatch = !!(
        !(window.quickMatch || safeRequire("quickMatch")) ||
        (window.quickMatch || safeRequire("quickMatch")).__offlineSingleplayerPatched
    );
    patchState.testSave = !!(
      !(window.pc || safeRequire("pc")) || (window.pc || safeRequire("pc")).__offlineSingleplayerSavePatched
    );
    patchState.userDataMgr = !!(
      !safeRequire("userDataMgr") ||
      (safeRequire("userDataMgr").getInstance && safeRequire("userDataMgr").getInstance().__offlineSingleplayerPatched)
    );
    patchState.userInfoMenu = !!(
      !safeRequire("UserInfoMenu") || safeRequire("UserInfoMenu").prototype.__offlineSingleplayerPatched
    );
    patchState.friendMenu = !!(
      !safeRequire("FriendMenu") || safeRequire("FriendMenu").prototype.__offlineSingleplayerPatched
    );
    patchState.favoriteMenu = !!(
      !safeRequire("FavoriteMenu") || safeRequire("FavoriteMenu").prototype.__offlineSingleplayerPatched
    );
    patchState.desktopIcon = !!(!window.initDesktopIcon || window.initDesktopIcon.__offlineSingleplayerPatched);
    patchState.sideBarIcon = !!(!window.initSideBarIcon || window.initSideBarIcon.__offlineSingleplayerPatched);
    return patchState;
  }

  function logRuntime(type, message, details) {
    var entry = {
      at: now(),
      type: type,
      message: trimText(message, 120),
      details: details ? trimText(JSON.stringify(details), 180) : "",
    };
    runtimeState.logs.unshift(entry);
    if (runtimeState.logs.length > offlineConfig.maxLogs) {
      runtimeState.logs.length = offlineConfig.maxLogs;
    }
    refreshDebugPanel();
    return entry;
  }

  function armRewardBlock(source, tag) {
    runtimeState.pendingRewardBlock = {
      source: source,
      tag: tag || "",
      createdAt: now(),
      expiresAt: now() + 10000,
    };
    logRuntime("reward-off", "广告奖励已关闭", { source: source, tag: tag || "" });
    refreshDebugPanel();
  }

  function consumeRewardBlock(request) {
    var block = runtimeState.pendingRewardBlock;
    if (!block) return false;
    if (block.expiresAt < now()) {
      runtimeState.pendingRewardBlock = null;
      refreshDebugPanel();
      return false;
    }
    if (!request || !request.add || !Object.keys(request.add).length) {
      return false;
    }
    logRuntime("reward-block", "已拦截一次广告奖励发放", {
      source: block.source,
      tag: block.tag || "",
      add: request.add,
    });
    request.add = {};
    runtimeState.pendingRewardBlock = null;
    refreshDebugPanel();
    return true;
  }

  function getCurrentSceneName() {
    try {
      var scene = window.cc && cc.director && cc.director.getScene && cc.director.getScene();
      return scene && scene.name ? scene.name : "-";
    } catch (err) {
      return "-";
    }
  }

  function getPatchLabel(key) {
    var labels = {
      net: "网络替身",
      sdk: "广告SDK",
      nativeSdk: "原生SDK",
      user: "用户数据",
      task: "任务数据",
      shop: "商店数据",
      social: "社交占位",
      pvp: "PVP降级",
      quickMatch: "匹配降级",
      testSave: "测试存档",
      userDataMgr: "资源存档",
      userInfoMenu: "资料页",
      friendMenu: "好友页",
      favoriteMenu: "关注页",
      desktopIcon: "桌面入口",
      sideBarIcon: "侧边栏入口",
    };
    return labels[key] || key;
  }

  function getLogTypeLabel(type) {
    var labels = {
      notice: "提示",
      route: "路由",
      updateData: "存档",
      slot: "存档位",
      sdk: "广告",
      nativeSdk: "原生",
      task: "任务",
      progression: "测试档",
      "reward-off": "奖励",
      "reward-block": "奖励",
    };
    return labels[type] || type;
  }

  function getRewardSourceLabel(source) {
    var labels = {
      video: "视频广告",
      share: "分享奖励",
      "native-video": "原生视频广告",
      "native-share": "原生分享奖励",
    };
    return labels[source] || source;
  }

  function buildDebugSnapshot() {
    snapshotPatchState();
    var patchLines = Object.keys(runtimeState.patchState).map(function (key) {
      return getPatchLabel(key) + ":" + (runtimeState.patchState[key] ? "已挂载" : "未挂载");
    });
    var pending = runtimeState.pendingRewardBlock
      ? getRewardSourceLabel(runtimeState.pendingRewardBlock.source) +
        (runtimeState.pendingRewardBlock.tag ? "（" + runtimeState.pendingRewardBlock.tag + "）" : "")
      : "无";
    return [
      "离线调试面板",
      "当前存档：" + (activeSlotId ? getSlotLabel(activeSlotId) : "未选择"),
      "当前场景：" + getCurrentSceneName(),
      "离线模式：已开启",
      "测试存档：" + (offlineConfig.testSaveEnabled ? "第" + offlineConfig.testSaveChapter + "章" : "已关闭"),
      "当前进度：" + getProgressionSummary(),
      "广告奖励：" + (offlineConfig.adRewardsEnabled ? "已开启" : "已关闭"),
      "待拦截奖励：" + pending,
      "签到次数：" + (ensureSignState().signCount || 0),
      "任务状态数：" + Object.keys(ensureDailyTaskState().status || {}).length,
      "邮件数量：" + ensureMailState().list.length,
      "在线宝箱：#" + (ensureOnlineBoxState().index || 0),
      "",
      "补丁状态：",
      patchLines.join(" | "),
      "",
      "最近日志：",
    ].concat(
      runtimeState.logs.length
        ? runtimeState.logs.map(function (entry) {
            return (
              "[" +
              formatClockTime(entry.at) +
              "] " +
              getLogTypeLabel(entry.type) +
              " " +
              entry.message +
              (entry.details ? " " + entry.details : "")
            );
          })
        : ["（暂无）"]
    );
  }

  function refreshDebugPanel() {
    if (!runtimeState.debugBody) return;
    runtimeState.debugBody.textContent = buildDebugSnapshot().join("\n");
  }

  function setDebugVisible(visible) {
    offlineConfig.debugPanelVisible = !!visible;
    runtimeState.debugVisible = !!visible;
    ensureDebugPanel();
    if (runtimeState.debugPanel) {
      runtimeState.debugPanel.style.display = visible ? "block" : "none";
    }
    refreshDebugPanel();
  }

  function ensureDebugPanel() {
    if (typeof document === "undefined" || runtimeState.debugPanel) return;
    if (!document.body) {
      setTimeout(ensureDebugPanel, 50);
      return;
    }
    var panel = document.createElement("div");
    panel.id = "offline-debug-panel";
    panel.style.cssText =
      "position:fixed;top:8px;right:8px;z-index:999999;max-width:320px;max-height:70vh;" +
      "overflow:auto;padding:10px 12px;background:rgba(5,8,14,0.9);color:#d7f8df;" +
      "border:1px solid rgba(130,230,160,0.45);border-radius:8px;font:12px/1.45 Menlo,Monaco,monospace;" +
      "box-shadow:0 12px 28px rgba(0,0,0,0.35);display:none;white-space:pre-wrap;";

    var controls = document.createElement("div");
    controls.style.cssText = "display:flex;gap:8px;margin-bottom:8px;";

    function makeButton(label, onClick) {
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.style.cssText =
        "padding:4px 8px;border:1px solid rgba(130,230,160,0.45);background:#182330;color:#d7f8df;" +
        "border-radius:4px;cursor:pointer;font:12px Menlo,Monaco,monospace;";
      button.addEventListener("click", onClick);
      return button;
    }

    controls.appendChild(
      makeButton("隐藏", function () {
        setDebugVisible(false);
      })
    );
    controls.appendChild(
      makeButton("清空日志", function () {
        runtimeState.logs = [];
        refreshDebugPanel();
      })
    );

    var body = document.createElement("pre");
    body.style.cssText = "margin:0;white-space:pre-wrap;word-break:break-word;";

    panel.appendChild(controls);
    panel.appendChild(body);
    document.body.appendChild(panel);

    runtimeState.debugPanel = panel;
    runtimeState.debugBody = body;
    refreshDebugPanel();
    if (offlineConfig.debugPanelVisible) {
      panel.style.display = "block";
    }
  }

  function installDebugPanel() {
    if (runtimeState.debugInstalled || typeof document === "undefined") return;
    runtimeState.debugInstalled = true;
    ensureDebugPanel();

    function toggleFromEvent(event) {
      var key = event && event.key;
      var code = event && event.code;
      var keyCode = event && event.keyCode;
      if (key === "`" || key === "~" || code === "Backquote" || keyCode === 192) {
        setDebugVisible(!runtimeState.debugVisible);
        return true;
      }
      return false;
    }

    function handleCornerTap(event) {
      if (!event) return;
      var width = window.innerWidth || document.documentElement.clientWidth || 0;
      var height = window.innerHeight || document.documentElement.clientHeight || 0;
      var x = typeof event.clientX === "number" ? event.clientX : width;
      var y = typeof event.clientY === "number" ? event.clientY : 0;
      if (x < width - 72 || y > 72) return;
      var ts = now();
      if (runtimeState.cornerTapUntil < ts) {
        runtimeState.cornerTapCount = 0;
      }
      runtimeState.cornerTapCount += 1;
      runtimeState.cornerTapUntil = ts + 2000;
      if (runtimeState.cornerTapCount >= 5) {
        runtimeState.cornerTapCount = 0;
        setDebugVisible(!runtimeState.debugVisible);
        showOfflineNotice(runtimeState.debugVisible ? "调试面板已打开" : "调试面板已关闭");
      }
    }

    document.addEventListener("keydown", toggleFromEvent);
    document.addEventListener("keyup", toggleFromEvent);
    if (window.addEventListener) {
      window.addEventListener("keydown", toggleFromEvent);
      window.addEventListener("keyup", toggleFromEvent);
      window.addEventListener("pointerdown", handleCornerTap, true);
      window.addEventListener("touchstart", handleCornerTap, true);
    }
    setInterval(function () {
      if (runtimeState.debugVisible) {
        refreshDebugPanel();
      }
    }, 500);
  }

  function releaseBootGate() {
    if (bootGateState.ready) return;
    bootGateState.ready = true;
    if (!bootGateState.actualBoot || !bootGateState.pendingArgs) return;
    var args = bootGateState.pendingArgs;
    bootGateState.pendingArgs = null;
    setTimeout(function () {
      bootGateState.actualBoot.apply(window, args);
    }, 0);
  }

  function installBootGate() {
    if (bootGateState.installed) return;
    bootGateState.installed = true;
    Object.defineProperty(window, "boot", {
      configurable: true,
      enumerable: true,
      get: function () {
        return function () {
          var args = Array.prototype.slice.call(arguments);
          if (!bootGateState.ready || !bootGateState.actualBoot) {
            bootGateState.pendingArgs = args;
            return;
          }
          return bootGateState.actualBoot.apply(window, args);
        };
      },
      set: function (fn) {
        bootGateState.actualBoot = fn;
      },
    });
  }

  function hideSaveSelector() {
    if (runtimeState.saveSelector) {
      runtimeState.saveSelector.style.display = "none";
    }
  }

  function createSlotCard(slotId, slot) {
    var card = document.createElement("div");
    card.style.cssText =
      "border:1px solid rgba(240,210,140,0.35);border-radius:16px;padding:14px 14px 12px;" +
      "background:rgba(16,20,28,0.92);box-shadow:0 12px 32px rgba(0,0,0,0.28);";

    var title = document.createElement("div");
    title.textContent = slot.name || getSlotLabel(slotId);
    title.style.cssText = "font:700 16px/1.2 'PingFang SC','Microsoft YaHei',sans-serif;color:#f8f1d2;";

    var summary = document.createElement("div");
    summary.textContent = getSlotSummaryText(slot);
    summary.style.cssText = "margin-top:10px;font:14px/1.4 'PingFang SC','Microsoft YaHei',sans-serif;color:#dce7ef;";

    var meta = document.createElement("div");
    meta.textContent = "最近游玩：" + formatDateTime(slot.updatedAt);
    meta.style.cssText = "margin-top:6px;font:12px/1.4 'PingFang SC','Microsoft YaHei',sans-serif;color:rgba(220,231,239,0.72);";

    var actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:10px;margin-top:14px;";

    function makeAction(label, styleText, onClick) {
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.style.cssText = styleText;
      button.addEventListener("click", onClick);
      return button;
    }

    actions.appendChild(
      makeAction(
        slot.used ? "进入" : "新建",
        "flex:1;padding:9px 0;border:0;border-radius:10px;background:#d1a64b;color:#12161f;" +
          "font:700 14px 'PingFang SC','Microsoft YaHei',sans-serif;cursor:pointer;",
        function () {
          selectSaveSlot(slotId);
        }
      )
    );

    if (slot.used) {
      actions.appendChild(
        makeAction(
          "删除",
          "padding:9px 14px;border:1px solid rgba(255,255,255,0.18);border-radius:10px;background:transparent;" +
            "color:#dce7ef;font:600 13px 'PingFang SC','Microsoft YaHei',sans-serif;cursor:pointer;",
          function () {
            if (!window.confirm("确认删除 " + (slot.name || getSlotLabel(slotId)) + " 吗？")) return;
            clearSlotData(slotId);
            updateSlotMeta(slotId, createDefaultSlotMeta(slotId));
            logRuntime("slot", "已删除本地存档", { slot: getSlotLabel(slotId) });
            renderSaveSelector();
          }
        )
      );
    }

    card.appendChild(title);
    card.appendChild(summary);
    card.appendChild(meta);
    card.appendChild(actions);
    return card;
  }

  function renderSaveSelector() {
    if (!runtimeState.saveSelectorBody) return;
    var manager = ensureSaveManager();
    runtimeState.saveSelectorBody.innerHTML = "";
    getSlotIds().forEach(function (slotId) {
      var slot = manager.slots[slotId] || createDefaultSlotMeta(slotId);
      runtimeState.saveSelectorBody.appendChild(createSlotCard(slotId, slot));
    });
  }

  function ensureSaveSelector() {
    if (runtimeState.saveSelector || typeof document === "undefined" || !document.body) return;
    var overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;" +
      "padding:20px;background:linear-gradient(180deg, rgba(6,10,16,0.92), rgba(8,12,20,0.98));";

    var panel = document.createElement("div");
    panel.style.cssText =
      "width:min(720px,100%);border:1px solid rgba(240,210,140,0.25);border-radius:22px;" +
      "padding:22px;background:rgba(10,14,20,0.92);box-shadow:0 20px 60px rgba(0,0,0,0.45);";

    var title = document.createElement("div");
    title.textContent = "选择本地进度";
    title.style.cssText = "font:700 24px/1.2 'PingFang SC','Microsoft YaHei',sans-serif;color:#f8f1d2;";

    var subtitle = document.createElement("div");
    subtitle.textContent = "开始游戏前先选择一个本地存档。每个进度都会单独保存资源、章节和邮件。";
    subtitle.style.cssText =
      "margin-top:10px;font:14px/1.6 'PingFang SC','Microsoft YaHei',sans-serif;color:rgba(220,231,239,0.8);";

    var body = document.createElement("div");
    body.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin-top:18px;";

    panel.appendChild(title);
    panel.appendChild(subtitle);
    panel.appendChild(body);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    runtimeState.saveSelector = overlay;
    runtimeState.saveSelectorBody = body;
    renderSaveSelector();
  }

  function startOfflineSingleplayer() {
    if (offlineInitialized) return;
    offlineInitialized = true;
    offlineConfig.debugPanelVisible = isDebugQueryEnabled();
    stubPlatformSdk();
    ensureProfile();
    ensureSignState();
    ensureDailyTaskState();
    ensureOnlineBoxState();
    ensureMailState();

    tryInstallRuntimePatches();
    installTimer = setInterval(tryInstallRuntimePatches, 25);
    setTimeout(function () {
      if (installTimer) {
        clearInterval(installTimer);
        installTimer = null;
      }
    }, oneDayMs);

    snapshotPatchState();
    installDebugPanel();
    setDebugVisible(offlineConfig.debugPanelVisible);
  }

  function selectSaveSlot(slotId) {
    var slot = setActiveSlot(slotId);
    if (!slot.used) {
      updateActiveSlotMeta({
        used: true,
        createdAt: slot.createdAt || now(),
        updatedAt: now(),
      });
      slot = ensureSaveManager().slots[slotId] || slot;
    }
    logRuntime("slot", "已选择本地进度", { slot: slot.name || getSlotLabel(slotId), summary: getSlotSummaryText(slot) });
    hideSaveSelector();
    startOfflineSingleplayer();
    releaseBootGate();
  }

  function loadJson(key, fallback) {
    try {
      var raw = localStorage.getItem(getActiveStoragePrefix() + key);
      return parseJson(raw, fallback);
    } catch (err) {
      console.warn("offline loadJson failed", key, err);
      return fallback;
    }
  }

  function saveJson(key, value) {
    try {
      localStorage.setItem(getActiveStoragePrefix() + key, JSON.stringify(value));
      markActiveSlotUsed();
    } catch (err) {
      console.warn("offline saveJson failed", key, err);
    }
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function assign(target, source) {
    var result = target || {};
    if (!source) return result;
    Object.keys(source).forEach(function (key) {
      result[key] = source[key];
    });
    return result;
  }

  function ensureProfile() {
    var profile = loadJson("profile", null);
    if (!profile) {
      profile = {
        createdAt: now(),
        beginner: true,
      };
      saveJson("profile", profile);
    }
    return profile;
  }

  function ensureSignState() {
    var state = loadJson("sign", null);
    var today = todayKey();
    if (!state) {
      state = {
        lastDay: today,
        signIndex: 0,
        signCount: 0,
      };
      saveJson("sign", state);
      return state;
    }
    if (state.lastDay !== today) {
      state.lastDay = today;
      state.signIndex = ((state.signIndex || 0) + 1) % 7;
      state.signCount = 0;
      saveJson("sign", state);
    }
    return state;
  }

  function ensureDailyTaskState() {
    var state = loadJson("daily-task", null);
    var today = todayKey();
    if (!state || state.lastDay !== today) {
      state = {
        lastDay: today,
        seed: nextResetAt(),
        refreshAt: nextResetAt(),
        status: {},
        ct: {},
      };
      saveJson("daily-task", state);
    }
    return state;
  }

  function ensureOnlineBoxState() {
    var state = loadJson("online-box", null);
    var today = todayKey();
    if (!state || state.lastDay !== today) {
      state = {
        lastDay: today,
        refreshAt: nextResetAt(),
        index: 0,
        time: 0,
      };
      saveJson("online-box", state);
    }
    return state;
  }

  function createDefaultShopState() {
    return {
      smallBoxCt: 11,
      smallBoxTime: nextResetAt(),
      midBoxTime: nextResetAt(),
      bigBoxCt: 1,
      bigBoxKey: 0,
      bigBoxTime: nextResetAt(),
      midBoxKey: 0,
      itemBoxTime: nextResetAt(),
      itemBoxSeed: (now() % 1999) + 1,
      itemBoxStatus: {
        0: 0,
        1: 0,
        2: 0,
        3: 0,
        4: 0,
        5: 0,
        6: 0,
        7: 0,
      },
      refreshCt: 20,
    };
  }

  function ensureShopState() {
    var state = loadJson("shop", null);
    var today = todayKey();
    if (!state || state.lastDay !== today) {
      state = assign(createDefaultShopState(), { lastDay: today });
      saveJson("shop", state);
      return state;
    }
    var changed = false;
    var fallback = createDefaultShopState();
    Object.keys(fallback).forEach(function (key) {
      if (typeof state[key] === "undefined") {
        state[key] = clone(fallback[key]);
        changed = true;
      }
    });
    if (changed) {
      saveJson("shop", state);
    }
    return state;
  }

  function ensureGuideState() {
    var profile = ensureProfile();
    var guide = clone(profile.guide || {});
    var defaults = {
      hero: 4,
      chapter: 2,
      talent: 1,
      equipmentSlot7: 1,
      equipmentSlot8: 1,
      desktop: 1,
      sideBar: 1,
      onlineBox: 2,
    };
    var changed = false;
    Object.keys(defaults).forEach(function (key) {
      if (typeof guide[key] === "undefined" || toNumber(guide[key], 0) < defaults[key]) {
        guide[key] = defaults[key];
        changed = true;
      }
    });
    if (changed || !profile.guide) {
      profile.guide = guide;
      saveJson("profile", profile);
    }
    return guide;
  }

  function createWelcomeMail() {
    return {
      list: [
        {
          id: "offline-welcome",
          status: 0,
          time: 0,
          exp: 30 * 24 * 60 * 60,
        },
      ],
      table: {
        "offline-welcome": {
          title: "离线单机版",
          author: "系统",
          head: "h2",
          full: true,
          text: "这是你的本地存档欢迎邮件。游戏已切到离线单机模式，签到、任务、邮件和奖励页面会优先走本地数据。",
          items: [],
        },
      },
    };
  }

  function ensureMailState() {
    var state = loadJson("mail", null);
    if (!state || !Array.isArray(state.list) || !state.table) {
      state = createWelcomeMail();
      saveJson("mail", state);
    }
    return state;
  }

  function saveMailStateFromUser() {
    if (!window.user) return;
    saveJson("mail", {
      list: clone(window.user.mailList || []),
      table: clone(window.user.mailInfoTable || {}),
    });
  }

  function mergeDocPayload(payload) {
    if (!payload || !payload.doc) return payload;
    var merged = clone(payload);
    Object.keys(payload.doc).forEach(function (key) {
      merged[key] = payload.doc[key];
    });
    return merged;
  }

  function safeRequire(name) {
    try {
      return window.__require ? window.__require(name) : null;
    } catch (err) {
      return null;
    }
  }

  function toNumber(value, fallback) {
    var num = Number(value);
    return isNaN(num) ? fallback : num;
  }

  function getTargetChapterIndex() {
    return Math.max(0, toNumber(offlineConfig.testSaveChapter, 10) - 1);
  }

  function getDisplayedChapterNumber(chapterIndex) {
    return Math.max(1, toNumber(chapterIndex, 0) + 1);
  }

  function getChapterStageStart(chapterIndex) {
    var adventure = window.adventure || safeRequire("adventure");
    if (adventure && adventure.chapterToStage) {
      return adventure.chapterToStage(chapterIndex, 0);
    }
    var chapters = window.CHAPTER_DEFINE_ARRAY || [];
    var total = 0;
    for (var i = 0; i < chapterIndex; i += 1) {
      total += chapters[i] && chapters[i].stage ? chapters[i].stage.length : 0;
    }
    return total;
  }

  function getStageDisplayName(stageIndex) {
    var adventure = window.adventure || safeRequire("adventure");
    if (adventure && adventure.stageToName) {
      return adventure.stageToName(Math.max(0, toNumber(stageIndex, 0))) || "未知";
    }
    return "未知";
  }

  function getProgressionSummary() {
    var pc = window.pc || safeRequire("pc");
    if (!pc) return "未初始化";
    var chapterIndex = typeof pc.getChapterIndex === "function" ? pc.getChapterIndex() : pc.chapterIndex;
    var stageIndex = toNumber(pc.stageIndex, 0);
    return "第" + getDisplayedChapterNumber(chapterIndex) + "章 / " + getStageDisplayName(stageIndex);
  }

  function getExcelRows(name) {
    var excel = window.excel || safeRequire("excel");
    if (!excel || !excel.read) return [];
    var rows = excel.read(name) || [];
    return Object.keys(rows)
      .sort(function (left, right) {
        var leftNum = Number(left);
        var rightNum = Number(right);
        if (!isNaN(leftNum) && !isNaN(rightNum)) {
          return leftNum - rightNum;
        }
        return String(left).localeCompare(String(right));
      })
      .map(function (key) {
        return rows[key];
      })
      .filter(Boolean);
  }

  function normalizeDataMap(source) {
    var result = {};
    if (!source || typeof source !== "object") return result;
    Object.keys(source).forEach(function (key) {
      var item = clone(source[key]) || {};
      item.id = item.id || key;
      if (item.id) {
        result[item.id] = item;
      }
    });
    return result;
  }

  function applyResourceFloorToDoc(doc) {
    var changed = false;
    var floor = offlineConfig.testSaveResourceFloor || {};
    var target = doc || {};
    ["gold", "diamond", "energy", "exp"].forEach(function (key) {
      var min = toNumber(floor[key], 0);
      if (min > 0 && toNumber(target[key], 0) < min) {
        target[key] = min;
        changed = true;
      }
    });
    return changed;
  }

  function applyResourceFloorToPayload(payload) {
    if (!payload || typeof payload !== "object") return false;
    var changed = applyResourceFloorToDoc(payload);
    if (payload.doc && typeof payload.doc === "object") {
      changed = applyResourceFloorToDoc(payload.doc) || changed;
    }
    return changed;
  }

  function buildSeededTeam(heroIds, heroRows) {
    var indexById = {};
    var team = { 0: -1, 1: -1, 2: -1, 3: -1 };
    heroRows.forEach(function (row, index) {
      if (row && row.id) {
        indexById[row.id] = index;
      }
    });
    for (var i = 0; i < 4; i += 1) {
      var heroId = heroIds[i];
      if (heroId && typeof indexById[heroId] === "number") {
        team[i] = indexById[heroId];
      }
    }
    return team;
  }

  function getTeamIdsFromPayload(team, heroRows, heroMap) {
    var ids = [];
    if (!team || typeof team !== "object") return ids;
    Object.keys(team)
      .sort()
      .forEach(function (slot) {
        var row = heroRows[team[slot]];
        if (row && row.id && heroMap[row.id] && ids.indexOf(row.id) < 0) {
          ids.push(row.id);
        }
      });
    return ids;
  }

  function buildSeededProgression(payload) {
    var next = clone(payload || {});
    var heroRows = getExcelRows("hero_list");
    var vehicleRows = getExcelRows("vehicle_list");
    var heroMap = normalizeDataMap(next.hero);
    var vehicleMap = normalizeDataMap(next.vehicle);
    var changed = false;
    var targetChapterIndex = getTargetChapterIndex();
    var targetStageIndex = getChapterStageStart(targetChapterIndex);

    if (toNumber(next.chapterIndex, 0) < targetChapterIndex) {
      next.chapterIndex = targetChapterIndex;
      changed = true;
    }
    if (toNumber(next.stageIndex, 0) < targetStageIndex) {
      next.stageIndex = targetStageIndex;
      changed = true;
    }

    changed = applyResourceFloorToPayload(next) || changed;

    var heroIds = Object.keys(heroMap);
    heroRows.forEach(function (row) {
      if (row && row.id && heroIds.length < 4 && heroIds.indexOf(row.id) < 0) {
        heroIds.push(row.id);
      }
    });
    heroIds = heroIds.slice(0, 4);
    heroIds.forEach(function (id) {
      var hero = heroMap[id] || { id: id };
      if (toNumber(hero.star, 0) < 1) {
        hero.star = 1;
        changed = true;
      }
      if (toNumber(hero.lvl, 1) < 12) {
        hero.lvl = 12;
        changed = true;
      }
      if (typeof hero.part === "undefined") {
        hero.part = 0;
        changed = true;
      }
      heroMap[id] = hero;
    });
    next.hero = heroMap;

    var vehicleIds = Object.keys(vehicleMap);
    vehicleRows.forEach(function (row) {
      if (row && row.id && vehicleIds.length < 2 && vehicleIds.indexOf(row.id) < 0) {
        vehicleIds.push(row.id);
      }
    });
    vehicleIds = vehicleIds.slice(0, 2);
    vehicleIds.forEach(function (id) {
      var vehicle = vehicleMap[id] || { id: id };
      if (toNumber(vehicle.star, 0) < 1) {
        vehicle.star = 1;
        changed = true;
      }
      if (toNumber(vehicle.atk, 0) < 10) {
        vehicle.atk = 10;
        changed = true;
      }
      if (toNumber(vehicle.hp, 0) < 10) {
        vehicle.hp = 10;
        changed = true;
      }
      if (toNumber(vehicle.skill, 0) < 4) {
        vehicle.skill = 4;
        changed = true;
      }
      if (typeof vehicle.part === "undefined") {
        vehicle.part = 0;
        changed = true;
      }
      vehicleMap[id] = vehicle;
    });
    next.vehicle = vehicleMap;

    var teamIds = getTeamIdsFromPayload(next.team, heroRows, heroMap);
    heroIds.forEach(function (heroId) {
      if (teamIds.length < 4 && teamIds.indexOf(heroId) < 0) {
        teamIds.push(heroId);
      }
    });
    var seededTeam = buildSeededTeam(teamIds.slice(0, 4), heroRows);
    if (JSON.stringify(next.team || {}) !== JSON.stringify(seededTeam)) {
      next.team = seededTeam;
      changed = true;
    }

    if (toNumber(next.vehicleIndex, -1) < 0 || !vehicleIds[toNumber(next.vehicleIndex, 0)]) {
      next.vehicleIndex = 0;
      changed = true;
    }

    var vehicleLink = assign({ 0: 1, 1: vehicleIds[1] ? 1 : 0, 2: 0 }, clone(next.vehicleLink || {}));
    vehicleLink[0] = 1;
    if (!vehicleIds[1]) {
      vehicleLink[1] = 0;
    }
    if (JSON.stringify(next.vehicleLink || {}) !== JSON.stringify(vehicleLink)) {
      next.vehicleLink = vehicleLink;
      changed = true;
    }

    return {
      changed: changed,
      payload: next,
      heroIds: heroIds,
      vehicleIds: vehicleIds,
      targetChapterIndex: targetChapterIndex,
      targetStageIndex: targetStageIndex,
    };
  }

  function persistProfileTestSave(summary) {
    var profile = ensureProfile();
    profile.testSave = assign(profile.testSave || {}, summary || {});
    profile.testSave.lastAppliedAt = now();
    saveJson("profile", profile);
  }

  function updateActiveSlotProgress(payload) {
    if (!activeSlotId || !payload) return;
    updateActiveSlotMeta({
      used: true,
      createdAt: (ensureSaveManager().slots[activeSlotId] || createDefaultSlotMeta(activeSlotId)).createdAt || now(),
      updatedAt: now(),
      chapter: getDisplayedChapterNumber(payload.chapterIndex),
      stageName: getStageDisplayName(payload.stageIndex),
    });
  }

  function maybeLogTestSave(result) {
    if (!result || !result.changed) return;
    var signature = [
      result.payload.chapterIndex,
      result.payload.stageIndex,
      Object.keys(result.payload.hero || {}).length,
      Object.keys(result.payload.vehicle || {}).length,
    ].join(":");
    if (runtimeState.lastTestSaveSignature === signature) return;
    runtimeState.lastTestSaveSignature = signature;
    persistProfileTestSave({
      enabled: true,
      chapter: getDisplayedChapterNumber(result.payload.chapterIndex),
      stageIndex: result.payload.stageIndex,
    });
    updateActiveSlotProgress(result.payload);
    logRuntime("progression", "已应用第10章测试存档", {
      chapter: getDisplayedChapterNumber(result.payload.chapterIndex),
      stage: getStageDisplayName(result.payload.stageIndex),
      heroes: Object.keys(result.payload.hero || {}).length,
      vehicles: Object.keys(result.payload.vehicle || {}).length,
    });
  }

  function extractPcPayload(pc) {
    return {
      chapterIndex: toNumber(pc.chapterIndex, 0),
      stageIndex: toNumber(pc.stageIndex, 0),
      hero: clone(pc.heroTable || {}),
      vehicle: clone(pc.vehicleTable || {}),
      team: clone(pc.team || {}),
      vehicleIndex: toNumber(pc.vehicleIndex, 0),
      vehicleLink: clone(pc.vehicleLink || {}),
      chapterBoxOpen: clone(pc.chapterBoxOpen || {}),
      difficultyBoxOpen: clone(pc.difficultyBoxOpen || {}),
    };
  }

  function applyPcSeedToRuntime(pc, result) {
    if (!pc || !result || !result.changed) return false;
    Object.keys(result.payload.hero || {}).forEach(function (id) {
      if (pc.setHero) {
        pc.setHero(result.payload.hero[id]);
      } else if (pc.heroTable) {
        pc.heroTable[id] = clone(result.payload.hero[id]);
      }
    });
    Object.keys(result.payload.vehicle || {}).forEach(function (id) {
      if (pc.setVehicle) {
        pc.setVehicle(result.payload.vehicle[id]);
      } else if (pc.vehicleTable) {
        pc.vehicleTable[id] = clone(result.payload.vehicle[id]);
      }
    });
    pc.chapterIndex = result.payload.chapterIndex;
    pc.stageIndex = result.payload.stageIndex;
    pc.team = clone(result.payload.team || {});
    pc.vehicleIndex = result.payload.vehicleIndex;
    pc.vehicleLink = clone(result.payload.vehicleLink || {});
    pc.chapterBoxOpen = clone(result.payload.chapterBoxOpen || {});
    pc.difficultyBoxOpen = clone(result.payload.difficultyBoxOpen || {});
    maybeLogTestSave(result);
    return true;
  }

  function writeUserDataRecord(key, value) {
    var scopedKey = getScopedUserDataKey(key);
    try {
      if (window.cc && cc.sys && cc.sys.localStorage) {
        cc.sys.localStorage.setItem(scopedKey, JSON.stringify(value));
        markActiveSlotUsed();
        return;
      }
      localStorage.setItem(scopedKey, JSON.stringify(value));
      markActiveSlotUsed();
    } catch (err) {
      console.warn("offline writeUserDataRecord failed", key, err);
    }
  }

  function walkNodes(node, visit) {
    if (!node) return;
    visit(node);
    var children = node.children || [];
    for (var i = 0; i < children.length; i += 1) {
      walkNodes(children[i], visit);
    }
  }

  function setNodeLabel(node, value) {
    if (!node) return;
    if (typeof node.string !== "undefined") {
      node.string = value;
      return;
    }
    if (!window.cc) return;
    var label = node.getComponent && node.getComponent(cc.Label);
    if (label) {
      label.string = value;
      return;
    }
    var richText = node.getComponent && node.getComponent(cc.RichText);
    if (richText) {
      richText.string = value;
    }
  }

  function rewriteMenuLabels(root) {
    walkNodes(root, function (node) {
      if (!node || !node.getComponent || !window.cc) return;
      var label = node.getComponent(cc.Label);
      if (!label || !label.string) return;
      if (label.string.indexOf("好友") >= 0 || label.string.indexOf("排行") >= 0) {
        label.string = "本地进度";
      } else if (label.string.indexOf("荣誉") >= 0 || label.string.indexOf("竞技") >= 0) {
        label.string = "单机模式";
      } else if (label.string.indexOf("胜率") >= 0 || label.string.indexOf("分数") >= 0) {
        label.string = "章节进度";
      } else if (
        label.string.indexOf("关注") >= 0 ||
        label.string.indexOf("订阅") >= 0 ||
        label.string.indexOf("桌面") >= 0 ||
        label.string.indexOf("侧边栏") >= 0
      ) {
        label.string = "单机功能";
      }
    });
  }

  function stubPlatformSdk() {
    if (!window.mpsdk) {
      window.mpsdk = {
        init: function () {
          return Promise.resolve({ openId: "offline-openid" });
        },
        Account: {
          setAccountInfo: function () {},
        },
        Report: {
          reportEvent: function () {},
        },
      };
    }
    if (!window.nativeSdk) {
      window.nativeSdk = {
        showVideo: function (tag, cb) {
          setTimeout(function () {
            if (cb) cb(true, tag);
          }, 0);
        },
        share: function (tag, text, cb) {
          setTimeout(function () {
            if (cb) cb(true, text || tag);
          }, 0);
        },
        checkVideo: function () {
          return true;
        },
        getUserId: function () {
          return "offline-native-user";
        },
        getChannelName: function () {
          return "offline";
        },
        onEvent: function () {},
        setEventHeader: function () {},
        showBanner: function () {},
        removeBanner: function () {},
      };
    }
  }

  function buildSignPayload() {
    var sign = ensureSignState();
    return {
      signIndex: sign.signIndex || 0,
      signCount: sign.signCount || 0,
      signRefreshTime: msUntilNextReset(),
    };
  }

  function buildDailyTaskPayload() {
    var daily = ensureDailyTaskState();
    return {
      dailyTaskSeed: daily.seed || nextResetAt(),
      dailyTaskRefreshTime: Math.max(0, (daily.refreshAt || nextResetAt()) - now()),
      dailyTaskStatus: clone(daily.status || {}),
      dailyTaskCt: clone(daily.ct || {}),
    };
  }

  function buildOnlineBoxPayload() {
    var state = ensureOnlineBoxState();
    return {
      onlineRefreshTime: Math.max(0, (state.refreshAt || nextResetAt()) - now()),
      onlineBoxIndex: state.index || 0,
      onlineBoxTime: state.time || 0,
    };
  }

  function buildShopPayload() {
    var state = ensureShopState();
    return {
      smallBoxCt: state.smallBoxCt || 0,
      smallBoxTime: state.smallBoxTime || nextResetAt(),
      midBoxTime: state.midBoxTime || nextResetAt(),
      bigBoxCt: state.bigBoxCt || 0,
      bigBoxKey: state.bigBoxKey || 0,
      bigBoxTime: state.bigBoxTime || nextResetAt(),
      midBoxKey: state.midBoxKey || 0,
      itemBoxTime: state.itemBoxTime || nextResetAt(),
      itemBoxSeed: state.itemBoxSeed || 1,
      itemBoxStatus: clone(state.itemBoxStatus || {}),
      shopRefreshCt: typeof state.refreshCt === "number" ? state.refreshCt : 20,
    };
  }

  function buildMailTable(ids) {
    var state = ensureMailState();
    var result = {};
    (ids || []).forEach(function (id) {
      if (state.table[id]) {
        result[id] = clone(state.table[id]);
      }
    });
    return result;
  }

  function showOfflineNotice(message) {
    var text = message || offlineNoticeText;
    logRuntime("notice", text);
    if (window.kit && window.kit.info) {
      window.kit.info(text);
      return;
    }
    console.log(text);
  }

  function getOfflineUserName() {
    if (window.user && window.user.getUserName && window.user.getUserName()) {
      return window.user.getUserName();
    }
    return "单机玩家";
  }

  function getOfflineHeadUrl() {
    if (window.user && window.user.getUserHeadUrl && window.user.getUserHeadUrl()) {
      return window.user.getUserHeadUrl();
    }
    return "0";
  }

  function buildOfflineRankList() {
    var chapterNumber = 1;
    if (window.pc && pc.getChapterIndex) {
      chapterNumber = getDisplayedChapterNumber(pc.getChapterIndex());
    }
    return [
      {
        rank: 1,
        name: getOfflineUserName(),
        avatarUrl: getOfflineHeadUrl(),
        score: "第" + chapterNumber + "章",
      },
    ];
  }

  function updateShopStateFromPayload(payload) {
    if (!payload || typeof payload !== "object") return false;
    var state = ensureShopState();
    var changed = false;
    [
      "smallBoxCt",
      "smallBoxTime",
      "midBoxTime",
      "bigBoxCt",
      "bigBoxKey",
      "bigBoxTime",
      "midBoxKey",
      "itemBoxTime",
      "itemBoxSeed",
      "shopRefreshCt",
    ].forEach(function (key) {
      if (typeof payload[key] !== "undefined") {
        var mappedKey = key === "shopRefreshCt" ? "refreshCt" : key;
        if (JSON.stringify(state[mappedKey]) !== JSON.stringify(payload[key])) {
          state[mappedKey] = clone(payload[key]);
          changed = true;
        }
      }
    });
    if (typeof payload.itemBoxStatus !== "undefined") {
      state.itemBoxStatus = clone(payload.itemBoxStatus || {});
      changed = true;
    }
    if (changed) {
      state.lastDay = todayKey();
      saveJson("shop", state);
    }
    return changed;
  }

  function patchNet() {
    if (!window.net || window.net.__offlineSingleplayerPatched) return false;

    var net = window.net;
    var originalPost = net.post && net.post.bind(net);
    var originalPostSilent = net.postSilent && net.postSilent.bind(net);
    var originalUpdateData = net.updateData && net.updateData.bind(net);

    function interceptRoute(route, args, cb) {
      if (route === "updateSignData") {
        logRuntime("route", "签到数据改为本地读取", buildSignPayload());
        if (cb) cb(0, buildSignPayload());
        return true;
      }
      if (route === "updateDailyTask") {
        logRuntime("route", "每日任务改为本地读取", buildDailyTaskPayload());
        if (cb) cb(0, buildDailyTaskPayload());
        return true;
      }
      if (route === "updateOnlineBox") {
        logRuntime("route", "在线宝箱改为本地读取", buildOnlineBoxPayload());
        if (cb) cb(0, buildOnlineBoxPayload());
        return true;
      }
      if (route === "getMailInfoTable") {
        logRuntime("route", "邮件详情表改为本地读取", { ids: args && args.ids ? args.ids.length : 0 });
        if (cb) cb(0, { mailTable: buildMailTable(args && args.ids) });
        return true;
      }
      if (route === "getMail") {
        var mailState = ensureMailState();
        var mail = mailState.table[args && args.id];
        logRuntime("route", "邮件正文改为本地读取", { id: args && args.id ? args.id : "" });
        if (cb) cb(0, { mail: clone(mail || {}) });
        return true;
      }
      if (route === "getGiftCode") {
        logRuntime("route", "礼包码功能在单机版中关闭");
        if (cb) cb(0, { res: "no_code" });
        return true;
      }
      if (route === "getBattleServer" || route === "getPvpData") {
        logRuntime("route", "联网/PVP请求已拒绝", { route: route });
        if (cb) cb(999, { msg: "单机版不支持联网功能" });
        return true;
      }
      if (route === "setGuest") {
        logRuntime("route", "访客登录改为本地 openId");
        if (cb) cb(0, { openId: localStorage.getItem("userId") || "offline-openid" });
        return true;
      }
      return false;
    }

    if (originalPost) {
      net.post = function (route, args, cb, retry) {
        if (interceptRoute(route, args, cb)) return;
        return originalPost(route, args, cb, retry);
      };
    }

    if (originalPostSilent) {
      net.postSilent = function (route, args, cb) {
        if (interceptRoute(route, args, cb)) return;
        return originalPostSilent(route, args, cb);
      };
    }

    if (originalUpdateData) {
      net.updateData = function (payload, cb) {
        var request = clone(payload || {});
        logRuntime("updateData", "收到本地数据更新请求", {
          addKeys: request.add ? Object.keys(request.add) : [],
          setKeys: request.set ? Object.keys(request.set) : [],
          mailId: request.mail && request.mail.id ? request.mail.id : "",
        });
        consumeRewardBlock(request);

        if (request.mail && window.user && Array.isArray(window.user.mailList)) {
          window.user.mailList = window.user.mailList.map(function (item) {
            if (item.id === request.mail.id) {
              var next = clone(item);
              next.status = request.mail.status;
              return next;
            }
            return item;
          });
          request.set = request.set || {};
          request.set.mailList = clone(window.user.mailList);
          saveMailStateFromUser();
        }

        if (request.add && typeof request.add.signCount === "number") {
          var sign = ensureSignState();
          sign.signCount = (sign.signCount || 0) + request.add.signCount;
          saveJson("sign", sign);
        }

        if (request.add && typeof request.add.onlineBoxIndex === "number") {
          var onlineAdd = ensureOnlineBoxState();
          onlineAdd.index = (onlineAdd.index || 0) + request.add.onlineBoxIndex;
          saveJson("online-box", onlineAdd);
        }

        if (request.add && typeof request.add.onlineBoxTime === "number") {
          var onlineTime = ensureOnlineBoxState();
          onlineTime.time = (onlineTime.time || 0) + request.add.onlineBoxTime;
          saveJson("online-box", onlineTime);
        }

        if (request.set) {
          var daily = ensureDailyTaskState();
          Object.keys(request.set).forEach(function (key) {
            if (key.indexOf("dailyTaskStatus") === 0) {
              daily.status = daily.status || {};
              daily.status[key.split(".").slice(1).join(".") || "sum"] = request.set[key];
            }
          });
          saveJson("daily-task", daily);
          if (updateShopStateFromPayload(request.set) && window.shop) {
            assign(window.shop, buildShopPayload());
          }
        }

        if (request.add && !Object.keys(request.add).length) {
          delete request.add;
        }

        return originalUpdateData(request, function (err, result) {
          var merged = mergeDocPayload(result);
          if (!err && merged && merged.doc) {
            if (typeof merged.signCount !== "undefined") {
              var latestSign = ensureSignState();
              latestSign.signCount = merged.signCount;
              saveJson("sign", latestSign);
            }
            if (typeof merged.onlineBoxIndex !== "undefined" || typeof merged.onlineBoxTime !== "undefined") {
              var latestOnline = ensureOnlineBoxState();
              if (typeof merged.onlineBoxIndex !== "undefined") latestOnline.index = merged.onlineBoxIndex;
              if (typeof merged.onlineBoxTime !== "undefined") latestOnline.time = merged.onlineBoxTime;
              saveJson("online-box", latestOnline);
            }
            if (merged.mailList) {
              saveJson("mail", {
                list: clone(merged.mailList),
                table: clone((window.user && window.user.mailInfoTable) || {}),
              });
            }
            if (updateShopStateFromPayload(merged)) {
              if (window.shop) {
                assign(window.shop, buildShopPayload());
              }
              logRuntime("route", "商店数据已同步到本地", {
                itemBoxSeed: merged.itemBoxSeed || null,
                refreshCt: typeof merged.shopRefreshCt !== "undefined" ? merged.shopRefreshCt : null,
              });
            }
          }
          logRuntime("updateData", err ? "本地数据更新失败" : "本地数据更新完成", {
            err: err || 0,
            signCount: merged && typeof merged.signCount !== "undefined" ? merged.signCount : null,
            onlineBoxIndex: merged && typeof merged.onlineBoxIndex !== "undefined" ? merged.onlineBoxIndex : null,
            hasMailList: !!(merged && merged.mailList),
          });
          if (cb) cb(err, merged);
        });
      };
    }

    net.__offlineSingleplayerPatched = true;
    return true;
  }

  function patchSdk() {
    if (!window.sdk || window.sdk.__offlineSingleplayerPatched) return false;

    var sdk = window.sdk;
    var originalNow = sdk.now && sdk.now.bind(sdk);

    sdk.now = function () {
      return originalNow ? originalNow() : now();
    };

    sdk.isVideoOpened = function () {
      return true;
    };

    sdk.showVideo = function (tag, cb) {
      logRuntime("sdk", "showVideo", { tag: tag || "" });
      if (offlineConfig.adRewardsEnabled && window.task && window.task.addDailyTaskCt) {
        window.task.addDailyTaskCt("videoCount");
      }
      if (!offlineConfig.adRewardsEnabled) {
        armRewardBlock("video", tag);
        showOfflineNotice(adRewardDisabledNoticeText);
      }
      setTimeout(function () {
        if (cb) cb(0, window.VIDEO_FREE || 1);
      }, 0);
    };

    sdk.showShare = function (tag, cb) {
      logRuntime("sdk", "showShare", { tag: tag || "" });
      if (!offlineConfig.adRewardsEnabled) {
        armRewardBlock("share", tag);
        showOfflineNotice(adRewardDisabledNoticeText);
      }
      setTimeout(function () {
        if (cb) cb(0, window.SHARE_FREE || 2);
      }, 0);
    };

    sdk.useFree = function (tag, cb) {
      logRuntime("sdk", "useFree", { tag: tag || "" });
      sdk.showVideo(tag, cb);
    };

    sdk.__offlineSingleplayerPatched = true;
    return true;
  }

  function patchNativeSdk() {
    if (!window.nativeSdk || window.nativeSdk.__offlineSingleplayerPatched) return false;

    var nativeSdk = window.nativeSdk;

    nativeSdk.showVideo = function (tag, cb) {
      logRuntime("nativeSdk", "showVideo", { tag: tag || "" });
      if (!offlineConfig.adRewardsEnabled) {
        armRewardBlock("native-video", tag);
        showOfflineNotice(adRewardDisabledNoticeText);
      }
      setTimeout(function () {
        if (cb) cb(true, tag);
      }, 0);
    };

    nativeSdk.share = function (tag, text, cb) {
      logRuntime("nativeSdk", "share", { tag: tag || "", text: text || "" });
      if (!offlineConfig.adRewardsEnabled) {
        armRewardBlock("native-share", tag);
        showOfflineNotice(adRewardDisabledNoticeText);
      }
      setTimeout(function () {
        if (cb) cb(true, text || tag);
      }, 0);
    };

    nativeSdk.__offlineSingleplayerPatched = true;
    return true;
  }

  function patchUser() {
    if (!window.user || window.user.__offlineSingleplayerPatched) return false;

    var user = window.user;
    var originalSetOnlineData = user.setOnlineData && user.setOnlineData.bind(user);

    if (originalSetOnlineData) {
      user.setOnlineData = function (payload) {
        var next = clone(payload || {});
        applyResourceFloorToPayload(next);
        next.guide = assign(ensureGuideState(), clone(next.guide || {}));
        assign(next, buildSignPayload());
        var mail = ensureMailState();
        next.mailList = clone(mail.list);
        next.mailInfoTable = clone(mail.table);
        return originalSetOnlineData(next);
      };
    }

    assign(user, buildSignPayload());
    user.mailList = clone(ensureMailState().list);
    user.mailInfoTable = clone(ensureMailState().table);
    user.feedSubscribeId = "";
    user.guide = assign(ensureGuideState(), clone(user.guide || {}));

    user.__offlineSingleplayerPatched = true;
    return true;
  }

  function patchTask() {
    if (!window.task || window.task.__offlineSingleplayerPatched) return false;

    var task = window.task;
    var originalSetOnlineData = task.setOnlineData && task.setOnlineData.bind(task);
    var originalAddDailyTaskCt = task.addDailyTaskCt && task.addDailyTaskCt.bind(task);
    var originalSetDailyTaskStatus = task.setDailyTaskStatus && task.setDailyTaskStatus.bind(task);

    if (originalSetOnlineData) {
      task.setOnlineData = function (payload) {
        var next = clone(payload || {});
        assign(next, buildDailyTaskPayload());
        return originalSetOnlineData(next);
      };
    }

    if (originalAddDailyTaskCt) {
      task.addDailyTaskCt = function (key, count) {
        var daily = ensureDailyTaskState();
        var delta = typeof count === "number" ? count : 1;
        daily.ct = daily.ct || {};
        daily.ct[key] = (daily.ct[key] || 0) + delta;
        saveJson("daily-task", daily);
        logRuntime("task", "每日任务计数更新", { key: key, delta: delta, total: daily.ct[key] });
        return originalAddDailyTaskCt(key, count);
      };
    }

    if (originalSetDailyTaskStatus) {
      task.setDailyTaskStatus = function (key, value) {
        var daily = ensureDailyTaskState();
        daily.status = daily.status || {};
        daily.status[key] = value;
        saveJson("daily-task", daily);
        logRuntime("task", "每日任务状态更新", { key: key, value: value });
        return originalSetDailyTaskStatus(key, value);
      };
    }

    var currentDaily = buildDailyTaskPayload();
    task.dailyTaskSeed = currentDaily.dailyTaskSeed;
    task.dailyTaskRefreshTime = now() + currentDaily.dailyTaskRefreshTime;
    task.dailyTaskStatus = clone(currentDaily.dailyTaskStatus);
    task.dailyTaskCt = clone(currentDaily.dailyTaskCt);

    task.__offlineSingleplayerPatched = true;
    return true;
  }

  function patchShop() {
    if (!window.shop || window.shop.__offlineSingleplayerPatched) return false;

    var shop = window.shop;
    var originalSetOnlineData = shop.setOnlineData && shop.setOnlineData.bind(shop);

    if (originalSetOnlineData) {
      shop.setOnlineData = function (payload) {
        var next = clone(payload || {});
        assign(next, buildShopPayload());
        assign(next, buildOnlineBoxPayload());
        updateShopStateFromPayload(next);
        return originalSetOnlineData(next);
      };
    }

    assign(shop, buildShopPayload());
    if (shop.loadOnlineBoxData) {
      shop.loadOnlineBoxData(buildOnlineBoxPayload());
    } else {
      var online = buildOnlineBoxPayload();
      shop.onlineRefreshTime = online.onlineRefreshTime;
      shop.onlineBoxIndex = online.onlineBoxIndex;
      shop.onlineBoxTime = online.onlineBoxTime;
      shop.onlineBoxStartTime = now();
    }

    shop.__offlineSingleplayerPatched = true;
    return true;
  }

  function patchMainMenu() {
    var MainMenu = safeRequire("MainMenu");
    if (!MainMenu || !MainMenu.prototype || MainMenu.prototype.__offlineSingleplayerPatched) {
      return false;
    }

    var originalUpdateGuide = MainMenu.prototype.updateGuide;

    MainMenu.prototype.updateGuide = function () {
      if (!offlineConfig.testSaveEnabled) {
        return originalUpdateGuide ? originalUpdateGuide.apply(this, arguments) : false;
      }
      var mapMenu = this.pageList && this.pageList[2] && this.pageList[2].getComponent && this.pageList[2].getComponent("Menu");
      var sideBoards = mapMenu && mapMenu.sideBoards;
      if (sideBoards && sideBoards.length) {
        for (var i = 0; i < sideBoards.length; i += 1) {
          if (sideBoards[i]) {
            sideBoards[i].active = true;
          }
        }
      }
      if (mapMenu) {
        if (mapMenu.signNode) mapMenu.signNode.active = true;
        if (mapMenu.mailNode) mapMenu.mailNode.active = true;
        if (mapMenu.offlineTaskNode) mapMenu.offlineTaskNode.active = true;
        if (mapMenu.dailyTaskNode) mapMenu.dailyTaskNode.active = true;
        if (mapMenu.stageTaskNode) mapMenu.stageTaskNode.active = true;
      }
      return false;
    };

    MainMenu.prototype.__offlineSingleplayerPatched = true;
    return true;
  }

  function patchSocial() {
    if (!window.user) return false;
    if (!window.hg) {
      window.hg = {};
    }
    if (window.hg.__offlineSingleplayerPatched) return false;

    window.hg.getUserInfo = function (options) {
      setTimeout(function () {
        if (options && options.success) {
          options.success({
            userInfo: {
              nickName: getOfflineUserName(),
              avatarUrl: getOfflineHeadUrl(),
            },
          });
        }
      }, 0);
    };

    window.hg.getRank = function (options) {
      setTimeout(function () {
        if (options && options.success) {
          options.success({
            ranks: buildOfflineRankList(),
          });
        }
      }, 0);
    };

    window.hg.__offlineSingleplayerPatched = true;
    return true;
  }

  function patchUserDataMgr() {
    var UserDataMgr = safeRequire("userDataMgr");
    if (!UserDataMgr || !UserDataMgr.getInstance) return false;
    var instance = UserDataMgr.getInstance();
    if (!instance || instance.__offlineSingleplayerPatched) return false;

    var originalGetUserData = instance.getUserData && instance.getUserData.bind(instance);
    var originalSetUserDocInfo = instance.setUserDocInfo && instance.setUserDocInfo.bind(instance);

    function ensureTestingDoc(key, data) {
      var next = clone(data || {});
      next.doc = next.doc || {};
      if (applyResourceFloorToDoc(next.doc)) {
        writeUserDataRecord(key, next);
        logRuntime("progression", "已补齐第10章测试资源", {
          gold: next.doc.gold || 0,
          diamond: next.doc.diamond || 0,
          energy: next.doc.energy || 0,
        });
      }
      return next;
    }

    if (originalGetUserData) {
      instance.getUserData = function (key) {
        return ensureTestingDoc(key, originalGetUserData(getScopedUserDataKey(key)));
      };
    }

    if (originalSetUserDocInfo) {
      instance.setUserDocInfo = function (key, payload) {
        return ensureTestingDoc(key, originalSetUserDocInfo(getScopedUserDataKey(key), payload));
      };
    }

    instance.__offlineSingleplayerPatched = true;
    return true;
  }

  function patchPc() {
    var pc = window.pc || safeRequire("pc");
    if (!pc || pc.__offlineSingleplayerSavePatched) return false;

    var originalSetOnlineData = pc.setOnlineData && pc.setOnlineData.bind(pc);

    if (originalSetOnlineData) {
      pc.setOnlineData = function (payload) {
        var result = offlineConfig.testSaveEnabled ? buildSeededProgression(payload || {}) : { payload: payload || {} };
        if (result.changed) {
          maybeLogTestSave(result);
        }
        updateActiveSlotProgress(result.payload);
        return originalSetOnlineData(result.payload);
      };
    }

    if (
      offlineConfig.testSaveEnabled &&
      pc.heroTable &&
      pc.vehicleTable &&
      Array.isArray(pc.heroList) &&
      Array.isArray(pc.vehicleList)
    ) {
      applyPcSeedToRuntime(pc, buildSeededProgression(extractPcPayload(pc)));
      updateActiveSlotProgress(extractPcPayload(pc));
    }

    pc.__offlineSingleplayerSavePatched = true;
    return true;
  }

  function patchPvp() {
    var pvp = window.pvp || safeRequire("pvp");
    if (!pvp || pvp.__offlineSingleplayerPatched) return false;
    var originalGetModeData = pvp.getModeData && pvp.getModeData.bind(pvp);
    var originalUpdateHonorIcon = pvp.updateHonorIcon && pvp.updateHonorIcon.bind(pvp);

    pvp.updateModeData = function (mode, cb) {
      var data = originalGetModeData ? originalGetModeData(mode) : null;
      if (data) {
        data.power = 0;
        data.date = 0;
        data.opened = false;
      }
      if (cb) cb();
    };

    pvp.isModeOpened = function () {
      return false;
    };

    pvp.getModePower = function () {
      return 0;
    };

    pvp.getModeTime = function () {
      return 0;
    };

    pvp.getHonor = function () {
      return 0;
    };

    pvp.getHonorIcon = function () {
      return originalUpdateHonorIcon ? originalUpdateHonorIcon(0) : "";
    };

    pvp.__offlineSingleplayerPatched = true;
    return true;
  }

  function patchQuickMatch() {
    var quickMatch = window.quickMatch || safeRequire("quickMatch");
    if (!quickMatch || quickMatch.__offlineSingleplayerPatched) return false;

    function deny(cb) {
      showOfflineNotice("单机版不支持联网对战");
      setTimeout(function () {
        if (cb) cb(-1);
      }, 0);
    }

    quickMatch.start = function (cb) {
      deny(cb);
    };

    quickMatch.accept = function (cb) {
      deny(cb);
    };

    quickMatch.join = function () {
      deny(quickMatch.matchCb);
    };

    quickMatch.matching = function () {
      deny(quickMatch.matchCb);
    };

    quickMatch.pushRobot = function () {
      deny(quickMatch.matchCb);
    };

    quickMatch.timeout = function () {
      deny(quickMatch.matchCb);
    };

    quickMatch.__offlineSingleplayerPatched = true;
    return true;
  }

  function patchUserInfoMenu() {
    var UserInfoMenu = safeRequire("UserInfoMenu");
    if (!UserInfoMenu || !UserInfoMenu.prototype || UserInfoMenu.prototype.__offlineSingleplayerPatched) {
      return false;
    }

    UserInfoMenu.prototype.initStatus = function () {
      this.refresh();
      if (this.advNum) {
        this.advNum.string = String(window.pc && pc.getChapterIndex ? getDisplayedChapterNumber(pc.getChapterIndex()) : 1);
      }
      if (this.pvpBoard) {
        this.pvpBoard.active = true;
        setNodeLabel(this.pvpBoard.getChildByName("n"), "单机进度");
        setNodeLabel(
          this.pvpBoard.getChildByName("v"),
          "已推进至 第" + (window.pc && pc.getChapterIndex ? getDisplayedChapterNumber(pc.getChapterIndex()) : 1) + "章"
        );
        var parent = this.pvpBoard.getParent && this.pvpBoard.getParent();
        if (parent && parent.children) {
          for (var i = 0; i < parent.children.length; i += 1) {
            if (parent.children[i] !== this.pvpBoard) {
              parent.children[i].active = false;
            }
          }
        }
      }
      rewriteMenuLabels(this.node);
    };

    UserInfoMenu.prototype.__offlineSingleplayerPatched = true;
    return true;
  }

  function patchFriendMenu() {
    var FriendMenu = safeRequire("FriendMenu");
    if (!FriendMenu || !FriendMenu.prototype || FriendMenu.prototype.__offlineSingleplayerPatched) {
      return false;
    }

    FriendMenu.prototype.initStatus = function () {
      if (this.scroll && this.scroll.node) {
        this.scroll.node.active = true;
      }
      if (this.right) {
        this.right.active = false;
      }
      this.initRankList(buildOfflineRankList());
      rewriteMenuLabels(this.node);
    };

    FriendMenu.prototype.initRankList = function (ranks) {
      var list = ranks && ranks.length ? ranks : buildOfflineRankList();
      this.uiList = this.uiList || [this.item];
      for (var index = 0; index < list.length; index += 1) {
        var rank = list[index];
        var item = this.uiList[index];
        if (!item) {
          item = this.uiList[index] = cc.instantiate(this.item);
          this.layoutNode.addChild(item);
        }
        item.active = true;
        var head = cc.find("headNode/head", item);
        if (head) {
          user.loadUserHead(head.getComponent(cc.Sprite), rank.avatarUrl);
        }
        setNodeLabel(cc.find("bar/name", item), rank.name || getOfflineUserName());
        setNodeLabel(item.getChildByName("index"), "#" + (rank.rank || index + 1));
        setNodeLabel(item.getChildByName("score"), rank.score || "第1章");
      }
      for (var i = list.length; i < this.uiList.length; i += 1) {
        if (this.uiList[i]) this.uiList[i].active = false;
      }
      rewriteMenuLabels(this.node);
    };

    FriendMenu.prototype.updateOpenRender = function () {};
    FriendMenu.prototype.__offlineSingleplayerPatched = true;
    return true;
  }

  function patchFavoriteMenu() {
    var FavoriteMenu = safeRequire("FavoriteMenu");
    if (!FavoriteMenu || !FavoriteMenu.prototype || FavoriteMenu.prototype.__offlineSingleplayerPatched) {
      return false;
    }

    FavoriteMenu.prototype.initStatus = function () {
      if (this.wxNode) this.wxNode.active = false;
      if (this.qqNode) this.qqNode.active = false;
      if (this.blNode) this.blNode.active = false;
      if (this.finger) {
        this.finger.stopAllActions && this.finger.stopAllActions();
        this.finger.active = false;
      }
      setNodeLabel(this.myTitleLabel, "单机说明");
      setNodeLabel(this.myBtnLabel, "知道了");
      setNodeLabel(
        this.myInfoLabel,
        "当前版本已关闭关注、分享和平台订阅奖励，只保留本地单机游玩。"
      );
      rewriteMenuLabels(this.node);
    };

    FavoriteMenu.prototype.onAdd = function () {
      showOfflineNotice("单机版已关闭关注与分享奖励");
      this.close && this.close();
    };

    FavoriteMenu.prototype.__offlineSingleplayerPatched = true;
    return true;
  }

  function patchPlatformPrompts() {
    var changed = false;

    if (window.initDesktopIcon && !window.initDesktopIcon.__offlineSingleplayerPatched) {
      window.initDesktopIcon = function (node) {
        if (!node) return;
        node.active = false;
        node.stopAllActions && node.stopAllActions();
        node.onTouch = function () {
          showOfflineNotice("单机版已关闭桌面快捷方式奖励");
        };
      };
      window.initDesktopIcon.__offlineSingleplayerPatched = true;
      changed = true;
    }

    if (window.initSideBarIcon && !window.initSideBarIcon.__offlineSingleplayerPatched) {
      window.initSideBarIcon = function (node) {
        if (!node) return;
        node.active = false;
        node.stopAllActions && node.stopAllActions();
        node.onTouch = function () {
          showOfflineNotice("单机版已关闭侧边栏奖励");
        };
      };
      window.initSideBarIcon.__offlineSingleplayerPatched = true;
      changed = true;
    }

    if (window.tt && !window.tt.__offlineSingleplayerPatched) {
      window.tt.requestFeedSubscribe = function (options) {
        if (options && options.fail) {
          options.fail({ errMsg: "offline disabled" });
        }
      };
      window.tt.checkFeedSubscribeStatus = function (options) {
        if (options && options.success) {
          options.success({ status: true });
        }
      };
      window.tt.addShortcut = function (options) {
        if (options && options.fail) {
          options.fail({ errMsg: "offline disabled" });
        }
      };
      window.tt.checkShortcut = function (options) {
        if (options && options.success) {
          options.success({ status: { exist: true } });
        }
      };
      window.tt.navigateToScene = function (options) {
        if (options && options.fail) {
          options.fail({ errMsg: "offline disabled" });
        }
      };
      window.tt.__offlineSingleplayerPatched = true;
      changed = true;
    }

    return changed;
  }

  function tryInstallRuntimePatches() {
    var patched = false;
    patched = patchNet() || patched;
    patched = patchSdk() || patched;
    patched = patchNativeSdk() || patched;
    patched = patchUser() || patched;
    patched = patchUserDataMgr() || patched;
    patched = patchTask() || patched;
    patched = patchShop() || patched;
    patched = patchSocial() || patched;
    patched = patchPc() || patched;
    patched = patchMainMenu() || patched;
    patched = patchPvp() || patched;
    patched = patchQuickMatch() || patched;
    patched = patchUserInfoMenu() || patched;
    patched = patchFriendMenu() || patched;
    patched = patchFavoriteMenu() || patched;
    patched = patchPlatformPrompts() || patched;

    snapshotPatchState();

    if (
      window.net &&
      window.sdk &&
      window.nativeSdk &&
      window.user &&
      window.task &&
      window.shop &&
      window.net.__offlineSingleplayerPatched &&
      window.sdk.__offlineSingleplayerPatched &&
      window.nativeSdk.__offlineSingleplayerPatched &&
      window.user.__offlineSingleplayerPatched &&
      window.task.__offlineSingleplayerPatched &&
      window.shop.__offlineSingleplayerPatched &&
      (!safeRequire("userDataMgr") || (safeRequire("userDataMgr").getInstance && safeRequire("userDataMgr").getInstance().__offlineSingleplayerPatched)) &&
      window.hg &&
      window.hg.__offlineSingleplayerPatched &&
      (!(window.pc || safeRequire("pc")) || (window.pc || safeRequire("pc")).__offlineSingleplayerSavePatched) &&
      (!(window.pvp || safeRequire("pvp")) || (window.pvp || safeRequire("pvp")).__offlineSingleplayerPatched) &&
      (!(window.quickMatch || safeRequire("quickMatch")) || (window.quickMatch || safeRequire("quickMatch")).__offlineSingleplayerPatched) &&
      (!safeRequire("UserInfoMenu") || safeRequire("UserInfoMenu").prototype.__offlineSingleplayerPatched) &&
      (!safeRequire("FriendMenu") || safeRequire("FriendMenu").prototype.__offlineSingleplayerPatched) &&
      (!safeRequire("FavoriteMenu") || safeRequire("FavoriteMenu").prototype.__offlineSingleplayerPatched) &&
      (!window.initDesktopIcon || window.initDesktopIcon.__offlineSingleplayerPatched) &&
      (!window.initSideBarIcon || window.initSideBarIcon.__offlineSingleplayerPatched) &&
      installTimer
    ) {
      clearInterval(installTimer);
      installTimer = null;
    }

    return patched;
  }

  installBootGate();
  ensureSaveManager();

  window.__OFFLINE_SINGLEPLAYER__ = {
    enabled: true,
    config: offlineConfig,
    now: now,
    todayKey: todayKey,
    loadJson: loadJson,
    saveJson: saveJson,
    saveManager: {
      ensure: ensureSaveManager,
      select: selectSaveSlot,
      render: renderSaveSelector,
      clear: clearSlotData,
    },
    profile: {
      ensure: ensureProfile,
    },
    sign: {
      ensure: ensureSignState,
      payload: buildSignPayload,
    },
    dailyTask: {
      ensure: ensureDailyTaskState,
      payload: buildDailyTaskPayload,
    },
    onlineBox: {
      ensure: ensureOnlineBoxState,
      payload: buildOnlineBoxPayload,
    },
    mail: {
      ensure: ensureMailState,
    },
    social: {
      buildOfflineRankList: buildOfflineRankList,
    },
    runtime: {
      logs: runtimeState.logs,
      patchState: runtimeState.patchState,
      tryInstallRuntimePatches: tryInstallRuntimePatches,
      snapshotPatchState: snapshotPatchState,
      getSnapshot: buildDebugSnapshot,
      setDebugVisible: setDebugVisible,
      toggleDebugVisible: function () {
        setDebugVisible(!runtimeState.debugVisible);
      },
      refreshDebugPanel: refreshDebugPanel,
    },
  };

  snapshotPatchState();
  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      function () {
        ensureSaveSelector();
      },
      { once: true }
    );
  } else {
    ensureSaveSelector();
  }
})();
