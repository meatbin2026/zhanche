(function () {
  var storagePrefix = "offline_singleplayer:";
  var oneDayMs = 24 * 60 * 60 * 1000;
  var installTimer = null;

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

  function loadJson(key, fallback) {
    try {
      var raw = localStorage.getItem(storagePrefix + key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      console.warn("offline loadJson failed", key, err);
      return fallback;
    }
  }

  function saveJson(key, value) {
    try {
      localStorage.setItem(storagePrefix + key, JSON.stringify(value));
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

  function setDeep(target, key, value) {
    if (!key || key.indexOf(".") === -1) {
      target[key] = value;
      return;
    }
    var ref = target;
    var parts = key.split(".");
    for (var i = 0; i < parts.length - 1; i += 1) {
      if (!ref[parts[i]] || typeof ref[parts[i]] !== "object") {
        ref[parts[i]] = {};
      }
      ref = ref[parts[i]];
    }
    ref[parts[parts.length - 1]] = value;
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

  function patchNet() {
    if (!window.net || window.net.__offlineSingleplayerPatched) return false;

    var net = window.net;
    var originalPost = net.post && net.post.bind(net);
    var originalPostSilent = net.postSilent && net.postSilent.bind(net);
    var originalUpdateData = net.updateData && net.updateData.bind(net);

    function interceptRoute(route, args, cb) {
      if (route === "updateSignData") {
        if (cb) cb(0, buildSignPayload());
        return true;
      }
      if (route === "updateDailyTask") {
        if (cb) cb(0, buildDailyTaskPayload());
        return true;
      }
      if (route === "updateOnlineBox") {
        if (cb) cb(0, buildOnlineBoxPayload());
        return true;
      }
      if (route === "getMailInfoTable") {
        if (cb) cb(0, { mailTable: buildMailTable(args && args.ids) });
        return true;
      }
      if (route === "getMail") {
        var mailState = ensureMailState();
        var mail = mailState.table[args && args.id];
        if (cb) cb(0, { mail: clone(mail || {}) });
        return true;
      }
      if (route === "getGiftCode") {
        if (cb) cb(0, { res: "no_code" });
        return true;
      }
      if (route === "getBattleServer" || route === "getPvpData") {
        if (cb) cb(999, { msg: "单机版不支持联网功能" });
        return true;
      }
      if (route === "setGuest") {
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
          }
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
      if (window.task && window.task.addDailyTaskCt) {
        window.task.addDailyTaskCt("videoCount");
      }
      setTimeout(function () {
        if (cb) cb(0, window.VIDEO_FREE || 1);
      }, 0);
    };

    sdk.showShare = function (tag, cb) {
      setTimeout(function () {
        if (cb) cb(0, window.SHARE_FREE || 2);
      }, 0);
    };

    sdk.useFree = function (tag, cb) {
      sdk.showVideo(tag, cb);
    };

    sdk.__offlineSingleplayerPatched = true;
    return true;
  }

  function patchUser() {
    if (!window.user || window.user.__offlineSingleplayerPatched) return false;

    var user = window.user;
    var originalSetOnlineData = user.setOnlineData && user.setOnlineData.bind(user);

    if (originalSetOnlineData) {
      user.setOnlineData = function (payload) {
        var next = clone(payload || {});
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
        return originalAddDailyTaskCt(key, count);
      };
    }

    if (originalSetDailyTaskStatus) {
      task.setDailyTaskStatus = function (key, value) {
        var daily = ensureDailyTaskState();
        daily.status = daily.status || {};
        daily.status[key] = value;
        saveJson("daily-task", daily);
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
        assign(next, buildOnlineBoxPayload());
        return originalSetOnlineData(next);
      };
    }

    var online = buildOnlineBoxPayload();
    shop.onlineRefreshTime = now() + online.onlineRefreshTime;
    shop.onlineBoxIndex = online.onlineBoxIndex;
    shop.onlineBoxTime = online.onlineBoxTime;
    shop.onlineBoxStartTime = now();

    shop.__offlineSingleplayerPatched = true;
    return true;
  }

  function tryInstallRuntimePatches() {
    var patched = false;
    patched = patchNet() || patched;
    patched = patchSdk() || patched;
    patched = patchUser() || patched;
    patched = patchTask() || patched;
    patched = patchShop() || patched;

    if (
      window.net &&
      window.sdk &&
      window.user &&
      window.task &&
      window.shop &&
      window.net.__offlineSingleplayerPatched &&
      window.sdk.__offlineSingleplayerPatched &&
      window.user.__offlineSingleplayerPatched &&
      window.task.__offlineSingleplayerPatched &&
      window.shop.__offlineSingleplayerPatched &&
      installTimer
    ) {
      clearInterval(installTimer);
      installTimer = null;
    }

    return patched;
  }

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

  window.__OFFLINE_SINGLEPLAYER__ = {
    enabled: true,
    now: now,
    todayKey: todayKey,
    loadJson: loadJson,
    saveJson: saveJson,
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
    runtime: {
      tryInstallRuntimePatches: tryInstallRuntimePatches,
    },
  };
})();
