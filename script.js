"use strict";

(() => {
  const $ = (id) => document.getElementById(id);

  const welcomeView = $("welcomeView");
  const workspaceView = $("workspaceView");
  const canvas = $("chartCanvas");
  const ctx = canvas ? canvas.getContext("2d") : null;

  const STORAGE_KEY = "naol-smart-trading-v1";

  const state = {
    strategy: "Naol Smart Strategy",
    tool: "select",
    symbol: "XAUUSD",
    timeframe: "M5",
    candles: [],
    drawings: [],
    undoStack: [],
    showGrid: true,
    zoom: 1,
    analysis: null,
    pendingStart: null,
    dragDrawing: null,
    textPoint: null,
    toastTimer: null,
    noteTimer: null
  };

  const palettes = {
    XAUUSD: { base: 2650, vol: 2.6, digits: 2 },
    BTCUSD: { base: 67400, vol: 180, digits: 1 },
    ETHUSD: { base: 3500, vol: 18, digits: 2 },
    EURUSD: { base: 1.082, vol: 0.0014, digits: 5 },
    SILVERUSDT: { base: 31.2, vol: 0.12, digits: 3 }
  };

  const colors = {
    green: "#35d39a",
    red: "#ff687e",
    blue: "#55b8ff",
    gold: "#f4c96b",
    purple: "#9b8cff",
    muted: "#71839c",
    grid: "#ffffff0b",
    text: "#b6c7dc"
  };

  function toast(message) {
    const el = $("toast");
    if (!el) return;

    el.textContent = message;
    el.classList.add("show");

    clearTimeout(state.toastTimer);

    state.toastTimer = setTimeout(() => {
      el.classList.remove("show");
    }, 2300);
  }

  function fmt(price) {
    const digits = (palettes[state.symbol] || palettes.XAUUSD).digits;

    return Number(price).toLocaleString("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[ch]));
  }

  function seedCandles() {
    const p = palettes[state.symbol] || palettes.XAUUSD;
    let close = p.base;
    const arr = [];

    // Illustrative demo candles, not live market prices.
    let seed = state.symbol
      .split("")
      .reduce((a, c) => a + c.charCodeAt(0), state.timeframe.length * 31);

    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    for (let i = 0; i < 86; i++) {
      const open = close;

      const drift =
        (rand() - 0.48) * p.vol * 0.9 +
        Math.sin(i / 8) * p.vol * 0.11;

      close = Math.max(p.base * 0.1, open + drift);

      const wickUp = rand() * p.vol * 0.32;
      const wickDown = rand() * p.vol * 0.32;

      arr.push({
        t: i,
        o: open,
        h: Math.max(open, close) + wickUp,
        l: Math.min(open, close) - wickDown,
        c: close
      });
    }

    state.candles = arr;

    if ($("currentPrice")) {
      $("currentPrice").textContent = fmt(arr[arr.length - 1].c);
    }

    if ($("chartSymbol")) {
      $("chartSymbol").textContent = state.symbol;
    }

    if ($("chartTf")) {
      $("chartTf").textContent = state.timeframe;
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        strategy: state.strategy,
        symbol: state.symbol,
        timeframe: state.timeframe,
        drawings: state.drawings,
        notes: $("notesInput")?.value || "",
        tradePlan: {
          direction: $("tradeDirection")?.value || "buy",
          entry: $("entryInput")?.value || "",
          sl: $("slInput")?.value || "",
          tp: $("tpInput")?.value || ""
        }
      }));
    } catch (error) {
      console.warn("Could not save workspace:", error);
    }
  }

  function restore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      const data = JSON.parse(raw);

      if (Array.isArray(data.drawings)) {
        state.drawings = data.drawings;
      }

      if (data.notes && $("notesInput")) {
        $("notesInput").value = data.notes;
      }

      if (data.tradePlan) {
        if ($("tradeDirection")) {
          $("tradeDirection").value = data.tradePlan.direction || "buy";
        }

        if ($("entryInput")) {
          $("entryInput").value = data.tradePlan.entry || "";
        }

        if ($("slInput")) {
          $("slInput").value = data.tradePlan.sl || "";
        }

        if ($("tpInput")) {
          $("tpInput").value = data.tradePlan.tp || "";
        }
      }
    } catch (error) {
      console.warn("Could not restore workspace:", error);
    }
  }

  function pushUndo() {
    state.undoStack.push(JSON.stringify(state.drawings));

    if (state.undoStack.length > 30) {
      state.undoStack.shift();
    }
  }

  function resizeCanvas() {
    if (!canvas || !ctx) return;

    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;

    canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    canvas.height = Math.max(1, Math.floor(rect.height * ratio));

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    renderChart();
  }

  function setTool(tool) {
    state.tool = tool || "select";

    document.querySelectorAll("[data-tool]").forEach((button) => {
      button.classList.toggle("active", button.dataset.tool === state.tool);
    });

    if (canvas) {
      canvas.style.cursor = state.tool === "select" ? "default" : "crosshair";
    }
  }

  function updateRR() {
    const entry = Number($("entryInput")?.value);
    const sl = Number($("slInput")?.value);
    const tp = Number($("tpInput")?.value);
    const direction = $("tradeDirection")?.value || "buy";
    const output = $("rrValue");

    if (!output) return;

    if (!(entry > 0 && sl > 0 && tp > 0)) {
      output.textContent = "—";
      return;
    }

    const risk = Math.abs(entry - sl);
    const reward = Math.abs(tp - entry);

    if (!risk) {
      output.textContent = "Invalid";
      return;
    }

    const valid = direction === "buy"
      ? sl < entry && tp > entry
      : sl > entry && tp < entry;

    output.textContent = valid
      ? "1:" + (reward / risk).toFixed(2)
      : "Check trade levels";
  }

  function openWorkspace(strategy) {
    state.strategy = strategy;

    if (welcomeView) welcomeView.classList.add("hidden");
    if (workspaceView) workspaceView.classList.remove("hidden");

    if ($("workspaceTitle")) {
      $("workspaceTitle").textContent = strategy;
    }

    if ($("workspaceSubtitle")) {
      $("workspaceSubtitle").textContent =
        strategy === "Manual Strategy"
          ? "Draw your own chart plan and test your reasoning."
          : "Rule-based chart analysis using transparent market-structure checks.";
    }

    if ($("modeSelect")) {
      $("modeSelect").value =
        strategy === "Manual Strategy" ? "manual" : "smart";
    }

    if ($("chartMessage")) {
      $("chartMessage").textContent =
        strategy === "Manual Strategy"
          ? "Manual drawing mode · Your chart plan stays yours"
          : "Rule-based analysis · Demo candles only";
    }

    setTool("select");

    window.scrollTo({ top: 0, behavior: "instant" });

    seedCandles();
    restore();
    renderChart();
  }

  // Kutaa 2ffaa itti fufa...
