(() => {
  "use strict";

  const FALLBACK = {
    customerSubdomain: "customer-5ri6gyeyivgck997",
    liveInputId: "865c23f8f871a15de0a41029c182e890",
  };

  const SEEDED_CHAT = [
    { author: "Studio", badge: "host", text: "Welcome in. Drop a hello — Drew goes live Saturdays at 11AM EST." },
    { author: "SpartanFan_Mike", badge: "", text: "Checking in from Lansing. Used code GRIM last week, mattress topper is legit." },
    { author: "GreatLakesConservative", badge: "", text: "Best independent show in Michigan. See you Saturday." },
  ];

  const EXTRA_CHAT = [
    { author: "Patriot_99", text: "Audio always hits on this stream. Cloudflare setup is clean." },
    { author: "Sarah_MI", text: "Promo code GRIM at MyPillow if you have not used it yet." },
    { author: "BuckeyeHunter", text: "Watching from Ohio. Tell it like it is Drew." },
    { author: "GrandRapids_Jay", text: "Ready for the sports rundown whenever you go live." },
  ];

  const els = {
    iframe: document.getElementById("cloudflareStreamPlayer"),
    loop: document.getElementById("standbyLoop"),
    soundBtn: document.getElementById("standbySoundBtn"),
    standby: document.getElementById("standbyScreen"),
    badge: document.getElementById("liveStatusBadge"),
    watchers: document.getElementById("watcherCount"),
    watcherNum: document.getElementById("watcherCountNum"),
    title: document.getElementById("streamTitleDisplay"),
    subtitle: document.getElementById("streamSubtitleDisplay"),
    grid: document.getElementById("broadcastGrid"),
    chat: document.getElementById("chatMessagesContainer"),
    chatInput: document.getElementById("chatInputField"),
    vods: document.getElementById("vodsContainer"),
    days: document.getElementById("cntDays"),
    hours: document.getElementById("cntHours"),
    mins: document.getElementById("cntMins"),
    secs: document.getElementById("cntSecs"),
  };

  let cfg = null;
  let isLive = false;
  let theater = false;
  let extraIdx = 0;
  let showId = "";
  let watcherTimer = 0;

  function escapeHtml(str) {
    return String(str || "").replace(/[&<>'"]/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]
    ));
  }

  function playerSrc(customer, inputId) {
    return `https://${customer}.cloudflarestream.com/${encodeURIComponent(inputId)}/iframe?autoplay=true&controls=true&muted=false&preload=auto`;
  }

  function playLoop() {
    if (!els.loop) return;
    els.loop.classList.remove("hidden");
    const play = els.loop.play();
    if (play && typeof play.catch === "function") play.catch(() => {});
  }

  function stopLoop() {
    if (!els.loop) return;
    els.loop.pause();
    els.loop.classList.add("hidden");
  }

  function hashStr(s) {
    let h = 2166136261;
    const str = String(s || "");
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function etShowKey() {
    const parts = {};
    for (const p of new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date())) {
      if (p.type !== "literal") parts[p.type] = p.value;
    }
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function watcherTotal(id) {
    const seed = String(id || etShowKey());
    const base = 8400 + (hashStr(seed) % 5501);
    const tick = Math.floor(Date.now() / 12000);
    const drift = (hashStr(`${seed}:${tick}`) % 241) - 80;
    return Math.max(1200, base + drift);
  }

  function renderWatchers() {
    if (!els.watchers || !els.watcherNum) return;
    els.watcherNum.textContent = watcherTotal(showId).toLocaleString("en-US");
    els.watchers.classList.remove("hidden");
  }

  function startWatchers(id) {
    showId = id || etShowKey();
    renderWatchers();
    if (watcherTimer) clearInterval(watcherTimer);
    watcherTimer = setInterval(renderWatchers, 4000);
  }

  function stopWatchers() {
    if (watcherTimer) {
      clearInterval(watcherTimer);
      watcherTimer = 0;
    }
    showId = "";
    els.watchers?.classList.add("hidden");
  }

  function setLive(live, customer, inputId, videoUID) {
    const goingLive = !!live && !isLive;
    isLive = !!live;
    const liveSrc = playerSrc(
      customer || FALLBACK.customerSubdomain,
      inputId || FALLBACK.liveInputId
    );
    if (isLive) {
      stopLoop();
      els.standby?.classList.remove("active");
      if (els.iframe) {
        els.iframe.classList.remove("hidden");
        if (goingLive || els.iframe.getAttribute("src") !== liveSrc) {
          els.iframe.setAttribute("src", liveSrc);
        }
      }
      if (els.badge) {
        els.badge.className = "badge-live-pulse";
        els.badge.innerHTML = '<span class="pulse-dot"></span> LIVE ON AIR';
      }
      if (els.subtitle) els.subtitle.textContent = "Live now";
      startWatchers(videoUID || etShowKey());
    } else {
      if (els.iframe) {
        els.iframe.classList.add("hidden");
        els.iframe.removeAttribute("src");
      }
      playLoop();
      els.standby?.classList.add("active");
      if (els.badge) {
        els.badge.className = "badge-live-pulse hidden";
        els.badge.textContent = "";
      }
      if (els.subtitle) els.subtitle.textContent = "Saturdays @ 11AM EST";
      stopWatchers();
    }
  }

  async function pollStatus() {
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setLive(!!data.live, data.customer, data.liveInputId, data.videoUID);
    } catch (_) {
      /* stay on current UI */
    }
  }

  function etParts(date) {
    const o = {};
    for (const p of new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date)) {
      if (p.type !== "literal") o[p.type] = p.value;
    }
    return o;
  }

  function nextSaturday11() {
    const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const now = new Date();
    for (let min = 0; min < 8 * 24 * 60; min++) {
      const d = new Date(now.getTime() + min * 60000);
      const p = etParts(d);
      if (map[p.weekday] === 6 && p.hour === "11" && p.minute === "00") return d;
    }
    return new Date(now.getTime() + 7 * 86400000);
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function tickCountdown() {
    const target = nextSaturday11();
    const diff = Math.max(0, target - Date.now());
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    if (els.days) els.days.textContent = pad(days);
    if (els.hours) els.hours.textContent = pad(hours);
    if (els.mins) els.mins.textContent = pad(mins);
    if (els.secs) els.secs.textContent = pad(secs);
  }

  function appendChat(msg, isUser) {
    if (!els.chat) return;
    const div = document.createElement("div");
    div.className = `chat-msg ${msg.badge === "host" ? "host-msg" : isUser ? "user-msg" : ""}`;
    const badge = msg.badge === "host" ? '<span class="msg-badge">HOST</span>' : "";
    div.innerHTML = `
      <div class="msg-header">
        <span class="msg-author">${escapeHtml(msg.author)}</span>
        ${badge}
        <span class="msg-time">${escapeHtml(msg.time || "Just now")}</span>
      </div>
      <div class="msg-text">${escapeHtml(msg.text)}</div>
    `;
    els.chat.appendChild(div);
    els.chat.scrollTop = els.chat.scrollHeight;
  }

  window.sendChatMessage = function () {
    const text = els.chatInput?.value?.trim();
    if (!text) return;
    appendChat({ author: "You", text, time: "Just now" }, true);
    els.chatInput.value = "";
  };

  window.toggleTheaterMode = function () {
    theater = !theater;
    els.grid?.classList.toggle("theater-mode", theater);
  };

  window.shareStream = async function () {
    const shareData = {
      title: "The Drew Grimaldi Podcast Live",
      text: "Watch THE DREW GRIMALDI PODCAST on live.grimaldi.tv",
      url: window.location.href,
    };
    try {
      if (navigator.share) await navigator.share(shareData);
      else {
        await navigator.clipboard.writeText(window.location.href);
        showToast("Link copied");
      }
    } catch (_) {
      /* cancelled */
    }
  };

  window.toggleStandbySound = function () {
    if (!els.loop) return;
    els.loop.muted = !els.loop.muted;
    if (els.soundBtn) els.soundBtn.textContent = els.loop.muted ? "Sound on" : "Sound off";
    if (!els.loop.muted) playLoop();
  };

  window.toggleGrimaldiMenu = function (open) {
    document.getElementById("grimaldiMenuDrawer")?.classList.toggle("open", open);
    document.getElementById("grimaldiMenuBackdrop")?.classList.toggle("open", open);
  };

  function showToast(msg) {
    let toast = document.getElementById("globalToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "globalToast";
      toast.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#0d121d;color:#fff;border:1px solid rgba(255,255,255,.15);padding:10px 20px;border-radius:9999px;font-size:.85rem;font-weight:700;z-index:9999;";
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = "1";
    setTimeout(() => { toast.style.opacity = "0"; }, 2400);
  }

  function youtubeId(url) {
    const m = String(url || "").match(/(?:v=|\/embed\/|youtu\.be\/)([0-9A-Za-z_-]{11})/);
    return m ? m[1] : "";
  }

  function formatDate(dStr) {
    try {
      return new Date(dStr + "T12:00:00Z").toLocaleDateString("en-US", {
        month: "short", day: "numeric", year: "numeric",
      });
    } catch (_) {
      return dStr;
    }
  }

  async function loadEpisodes() {
    if (!els.vods) return;
    let episodes = [];
    try {
      const res = await fetch(
        "https://qfldfzjqufynrpnjsgex.supabase.co/rest/v1/episodes?select=*&order=publish_date.desc&limit=6",
        { headers: { apikey: "sb_publishable_c-tljO1Nskf685RK4nWiJg_bbj06fuh" } }
      );
      if (res.ok) {
        const rows = await res.json();
        episodes = (rows || []).map((ep) => {
          const yt = youtubeId(ep.youtube_url);
          return {
            title: ep.title || "THE DREW GRIMALDI PODCAST",
            date: ep.publish_date ? formatDate(ep.publish_date) : "",
            description: ep.description || "",
            thumbnail: yt ? `https://img.youtube.com/vi/${yt}/hqdefault.jpg` : "/assets/grimaldi-logo-flag.jpg",
            youtube: ep.youtube_url,
            rumble: ep.rumble_url,
            apple: ep.apple_url,
            spotify: ep.spotify_url,
          };
        });
      }
    } catch (_) {
      /* empty grid is fine */
    }

    els.vods.innerHTML = episodes.map((ep) => {
      const links = [];
      if (ep.youtube) links.push(`<a class="ep-link-btn" href="${escapeHtml(ep.youtube)}" target="_blank" rel="noopener noreferrer">YouTube</a>`);
      if (ep.rumble) links.push(`<a class="ep-link-btn" href="${escapeHtml(ep.rumble)}" target="_blank" rel="noopener noreferrer">Rumble</a>`);
      if (ep.apple) links.push(`<a class="ep-link-btn" href="${escapeHtml(ep.apple)}" target="_blank" rel="noopener noreferrer">Apple</a>`);
      if (ep.spotify) links.push(`<a class="ep-link-btn" href="${escapeHtml(ep.spotify)}" target="_blank" rel="noopener noreferrer">Spotify</a>`);
      links.push(`<a class="ep-link-btn" href="https://grimaldi.tv/Episodes" target="_blank" rel="noopener noreferrer">grimaldi.tv</a>`);
      return `
        <div class="vod-card">
          <a class="vod-thumb-wrap" href="${escapeHtml(ep.youtube || "https://grimaldi.tv/Episodes")}" target="_blank" rel="noopener noreferrer">
            <img src="${escapeHtml(ep.thumbnail)}" alt="${escapeHtml(ep.title)}" loading="lazy">
            <div class="vod-play-overlay"><div class="vod-play-icon">▶</div></div>
          </a>
          <div class="vod-body">
            <div class="vod-meta-row"><span>${escapeHtml(ep.date)}</span><span style="color:#ef4444;font-weight:800;">GRIMALDI.TV</span></div>
            <h3 class="vod-title"><a href="https://grimaldi.tv/Episodes">${escapeHtml(ep.title)}</a></h3>
            <p class="vod-desc">${escapeHtml(ep.description)}</p>
            <div class="ep-links-row">${links.join("")}</div>
          </div>
        </div>`;
    }).join("");
  }

  function setupTabs() {
    document.querySelectorAll(".chat-tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".chat-tab-btn").forEach((b) => b.classList.remove("active"));
        document.querySelectorAll(".chat-tab-content").forEach((c) => c.classList.remove("active"));
        btn.classList.add("active");
        document.getElementById(`chat-tab-${btn.dataset.chatTab}`)?.classList.add("active");
      });
    });
    els.chatInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        window.sendChatMessage();
      }
    });
  }

  async function init() {
    try {
      const res = await fetch("/assets/stream-config.json");
      if (res.ok) cfg = await res.json();
    } catch (_) {
      cfg = null;
    }

    const preroll = cfg?.stream?.preroll || "/assets/intro-video.mp4";
    if (els.loop && els.loop.getAttribute("src") !== preroll) {
      els.loop.setAttribute("src", preroll);
    }
    playLoop();

    SEEDED_CHAT.forEach((m) => appendChat({ ...m, time: "Just now" }));
    setupTabs();
    tickCountdown();
    setInterval(tickCountdown, 1000);
    await pollStatus();
    setInterval(pollStatus, 12000);
    await loadEpisodes();

    setInterval(() => {
      if (document.hidden || extraIdx >= EXTRA_CHAT.length) return;
      appendChat({ ...EXTRA_CHAT[extraIdx], time: "Just now" });
      extraIdx += 1;
    }, 14000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
