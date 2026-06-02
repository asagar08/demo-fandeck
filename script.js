/* global $, gsap, Draggable, tinycolor */

/**
 * Asian Paints Digital Fandeck
 * ------------------------------------------------------------
 * Data strategy:
 * - This static project reads shade data from the local `apcatalogue.json` file.
 * - No live Asian Paints API, local Node proxy, Netlify function, or server file is required.
 * - For custom data, set `window.ASIAN_PAINTS_FANDECK = { dataUrl: "your-file.json" }`
 *   before loading this script.
 *
 * UI strategy:
 * - Fan card/strip click opens the shade details modal only.
 * - Plus / save buttons shortlist colours and update the header CTA badge.
 * - Header CTA opens the separate Colour Selection modal.
 */
const CONFIG = window.ASIAN_PAINTS_FANDECK || {};
const CATALOGUE_DATA_URL = CONFIG.dataUrl || "apcatalogue.json";

const MAX_CARDS_DESKTOP = 33;
const MAX_CARDS_MOBILE = 23;
const FAVORITE_KEY = "asianpaints-fandeck-favorites-v1";
const PALETTE_KEY = "asianpaints-fandeck-selection-v1";
const MAX_SELECTION = 8;

const state = {
  all: [],
  filtered: [],
  category: "All",
  selectedIndex: 0,
  selectedId: null,
  favorites: new Set(),
  favoritesOnly: false,
  selectedPalette: [],
  currentSmartPalette: [],
  dragProxy: null,
  isDragging: false,
  lastQuery: "",
  suppressFanClickUntil: 0,
  dataSource: "",
  deckWindow: { key: "", start: 0, end: 0 },
  swipeFrame: null,
  swipePendingIndex: null,
  // Holds the exact colour currently displayed in the details popup.
  // This can be the main API shade or a generated cap/strip sample.
  currentModalColor: null
};

const dom = {};

$(init);

async function init() {
  cacheDom();
  registerPlugins();
  bindEvents();
  loadFavorites();
  loadSelectedPalette();
  renderSelectedPalette();
  setLoading(true);

  try {
    const shades = await fetchShadeData();
    state.all = prepareShadeList(shades);

    if (!state.all.length) {
      showDataError("The shade API responded, but no usable colours were found. Please confirm the API returns shade name/code plus HEX or RGB values.");
      return;
    }

    showToast(`Loaded ${state.all.length} Asian Paints shades.`);
  } catch (error) {
    console.warn("Catalogue data fetch failed.", error);
    showDataError(`Could not load apcatalogue.json. Run the project through a static web server, not by double-clicking index.html. ${error.message || ""}`);
    return;
  }

  state.filtered = [...state.all];
  state.selectedId = state.filtered[0]?.id || null;

  buildCategoryTabs();
  applyFilter("All", { silent: true });
  setupGsapIntro();
  setupDraggable();
  setLoading(false);
}

function cacheDom() {
  dom.body = $(document.body);
  dom.fanDeck = $("#fanDeck");
  dom.fanStage = $("#fanStage");
  dom.tabs = $("#categoryTabs");
  dom.range = $("#rangeSlider");
  dom.rangeCount = $("#rangeCount");
  dom.search = $("#shadeSearch");
  dom.clearSearch = $("#clearSearch");
  dom.suggestions = $("#suggestions");
  dom.progressText = $("#progressText");
  dom.shadeTotal = $("#shadeTotal");
  dom.progressFill = $("#progressFill");
  dom.progressKnob = $("#progressKnob");
  dom.progressTrack = $("#progressTrack");
  dom.selectedBeacon = $("#selectedBeacon");
  dom.beaconSwatch = $(".beacon-swatch");
  dom.beaconName = $(".beacon-copy strong");
  dom.beaconMeta = $(".beacon-copy small");
  dom.activeFamily = $("#activeFamily");
  dom.activeName = $("#activeName");
  dom.activeCode = $("#activeCode");
  dom.activeHex = $("#activeHex");
  dom.activeRgb = $("#activeRgb");
  dom.previewWall = $("#previewWall");
  dom.favoriteCurrent = $("#favoriteCurrent");
  dom.favoriteTray =  $("#favoriteTray, #favoriteTrayMob");
  dom.toggleFavorites = $("#toggleFavorites");
  dom.openDetails = $("#openDetails");
  dom.randomShade = $("#randomShade");
  dom.prevShade = $("#prevShade");
  dom.nextShade = $("#nextShade");
  dom.resetDeck = $("#resetDeck");
  dom.overlay = $("#modalOverlay");
  dom.selectionOverlay = $("#selectionOverlay");
  dom.closeModal = $("#closeModal");
  dom.closeSelectionModal = $("#closeSelectionModal");
  dom.modalSwatch = $("#modalSwatch");
  dom.modalFamily = $("#modalFamily");
  dom.modalShadeName = $("#modalShadeName");
  dom.modalShadeCode = $("#modalShadeCode");
  dom.modalHex = $("#modalHex");
  dom.modalRgb = $("#modalRgb");
  dom.modalCode = $("#modalCode");
  dom.smartPalette = $("#smartPalette");
  dom.selectionBento = $("#selectionBento");
  dom.selectionCount = $("#selectionCount");
  dom.clearSelection = $("#clearSelection");
  dom.selectionBadge = $("#selectionBadge");
  dom.paletteHint = $("#paletteHint");
  dom.modalFavorite = $("#modalFavorite");
  dom.modalNext = $("#modalNext");
  dom.toast = $("#toast");
}

function registerPlugins() {
  if (window.gsap && window.Draggable) gsap.registerPlugin(Draggable);
}

function bindEvents() {
  // Range/arrow controls update the selected shade without page-scroll side effects.
  dom.range.on("input", function () {
    setSelectedIndex(Number(this.value), { source: "range" });
  });

  dom.prevShade.on("click", () => stepShade(-1));
  dom.nextShade.on("click", () => stepShade(1));
  dom.modalNext.on("click", () => {
    stepShade(1);
    openModal(getSelectedShade());
  });
  dom.resetDeck.on("click", () => {
    setSelectedIndex(0, { source: "reset" });
    pulseDeck();
  });
  dom.randomShade.on("click", () => {
    if (!state.filtered.length) return;
    const randomIndex = Math.floor(Math.random() * state.filtered.length);
    setSelectedIndex(randomIndex, { source: "random" });
    openModal(getSelectedShade());
  });

  dom.progressTrack.on("click", function (event) {
    const rect = this.getBoundingClientRect();
    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    setSelectedIndex(Math.round(ratio * (state.filtered.length - 1)), { source: "progress" });
  });

  // Header CTA is the only entry point for the Colour Selection popup.
  dom.openDetails.on("click", openSelectionModal);
  dom.selectedBeacon.on("click", () => openModal(getSelectedShade()));
  dom.closeModal.on("click", closeModal);
  dom.closeSelectionModal.on("click", closeSelectionModal);
  dom.overlay.on("click", event => {
    if (event.target === dom.overlay[0]) closeModal();
  });
  dom.selectionOverlay.on("click", event => {
    if (event.target === dom.selectionOverlay[0]) closeSelectionModal();
  });

  dom.favoriteCurrent.on("click", () => shortlistShade(getSelectedShade(), dom.favoriteCurrent[0]));
  dom.modalFavorite.on("click", () => shortlistShade(state.currentModalColor || getSelectedShade(), dom.modalFavorite[0]));
  dom.toggleFavorites.on("click", toggleFavoritesFilter);

  dom.search.on("input", debounce(handleSearchInput, 80));
  dom.search.on("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      const first = dom.suggestions.find(".suggestion-item").first();
      if (first.length) selectById(first.data("id"), { source: "search", open: true });
    }
    if (event.key === "Escape") clearSearch();
  });
  dom.clearSearch.on("click", clearSearch);

  dom.suggestions.on("click", ".suggestion-item", function () {
    selectById($(this).data("id"), { source: "search", open: true });
    dom.suggestions.hide();
  });

  // Plus buttons shortlist the exact catalogue shade represented by the clicked strip.
  dom.fanDeck.on("click", ".strip-add", function (event) {
    if (shouldSuppressFanClick()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();

    const sampleNode = $(this).closest(".card-cap, .card-strip");
    const card = $(this).closest(".fan-card");
    const shade = findShadeById(String(card.data("id") || ""));
    if (!shade || !sampleNode.length) return;

    const sample = paletteItemFromElement(shade, sampleNode[0]);
    if (sample?.shadeId) {
      const sampleIndex = findFilteredIndexById(sample.shadeId);
      if (sampleIndex >= 0) setSelectedIndex(sampleIndex, { source: "shortlist" });
    }

    savePaletteColor(sample, { origin: this });
  });

  // Clicking a cap/strip now opens the real shade from the same pageNumber group.
  dom.fanDeck.on("click", ".card-cap, .card-strip", function (event) {
    if (shouldSuppressFanClick()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();

    const card = $(this).closest(".fan-card");
    const shade = findShadeById(String(card.data("id") || ""));
    if (!shade) return;

    const sample = shadeSampleFromElement(shade, this);
    const nextShade = sample || shade;
    const nextIndex = findFilteredIndexById(nextShade.id);
    if (nextIndex >= 0) setSelectedIndex(nextIndex, { source: "strip" });

    openModal(nextShade, { sample: nextShade });
  });

  dom.fanDeck.on("click", ".fan-card", function (event) {
    if (shouldSuppressFanClick()) {
      event.preventDefault();
      return;
    }
    if ($(event.target).closest(".card-cap, .card-strip, .card-fav, .strip-add").length) return;
    const id = $(this).data("id");
    const index = state.filtered.findIndex(shade => shade.id === id);
    if (index >= 0) {
      setSelectedIndex(index, { source: "card" });
      openModal(getSelectedShade());
    }
  });

  dom.fanDeck.on("click", ".card-fav", function (event) {
    if (shouldSuppressFanClick()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();

    const card = $(this).closest(".fan-card");
    const shade = findShadeById(String(card.data("id") || ""));
    if (!shade) return;

    const index = findFilteredIndexById(shade.id);
    if (index >= 0) setSelectedIndex(index, { source: "heart" });

    state.favorites.add(shade.id);
    persistFavorites();

    card.addClass("favorite shortlisted");
    $(this).find("i").attr("class", "ri-heart-3-fill");

    shortlistShade(shade, this);
  });

  dom.favoriteTray.on("click", ".selection-mini", function () {
    const shadeId = $(this).data("shadeId");
    if (shadeId) selectById(shadeId, { source: "selection" });
  });

  // Compact tray CTA opens the dedicated Colour Selection popup.
  dom.favoriteTray.on("click", ".review-selection", function () {
    openSelectionModal();
  });

  dom.selectionBento.on("click", ".remove-selection", function (event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    removePaletteColor($(this).data("key"));
  });
  dom.selectionBento.on("click", ".selection-card", function (event) {
      if ($(event.target).closest(".remove-selection, .tile-cta, .selection-card-cta").length)
          return;

      var shadeId = $(this).data("shadeId");
      if (!shadeId)
          return;

      closeSelectionModal({ instant: true });
      selectById(shadeId, { source: "selection-popup", open: true });
  });

  dom.clearSelection.on("click", clearSelectedPalette);

  $(document).on("keydown", event => {
    const isTyping = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);
    if (event.key === "Escape") { closeModal(); closeSelectionModal(); }
    if (event.key === "/" && !isTyping) {
      event.preventDefault();
      dom.search.trigger("focus");
    }
    if (!isTyping && event.key === "ArrowLeft") stepShade(-1);
    if (!isTyping && event.key === "ArrowRight") stepShade(1);
    if (!isTyping && event.key === "Enter") openModal(getSelectedShade());
  });


  $(".copy-chip").on("click", function () {
    const shade = state.currentModalColor || getSelectedShade();
    if (!shade) return;
    const type = $(this).data("copy");
    const value = type === "rgb" ? shade.rgbText : type === "code" ? shade.code : shade.hex;
    copyToClipboard(value);
  });

  $(window).on("resize", debounce(() => {
    renderDeck({ animate: false });
    setupDraggable();
  }, 160));
}

async function fetchShadeData() {
  // The uploaded Asian Paints catalogue is shaped as:
  // { success: true, shade: [{ entityName, entityCode, shadeFamily, shadeHexCode, ... }] }
  // We also keep support for { shades: [...] } and nested shade objects for easy reuse.
  const response = await fetch(CATALOGUE_DATA_URL, {
    cache: "no-store",
    headers: { Accept: "application/json,text/plain,*/*" }
  });

  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(`${CATALOGUE_DATA_URL} returned HTTP ${response.status}.`);
  }

  const payload = parsePossiblyWrappedJson(rawText);
  state.dataSource = CATALOGUE_DATA_URL;

  const raw = Array.isArray(payload?.shade)
    ? payload.shade
    : Array.isArray(payload?.shades)
      ? payload.shades
      : Array.isArray(payload)
        ? payload
        : extractShadeObjects(payload);

  const shades = raw.map((item, index) => normalizeShade(item, index)).filter(Boolean);
  if (!shades.length) {
    throw new Error("Catalogue JSON loaded, but no usable shade entries with name/code and HEX/RGB were found.");
  }

  return shades;
}

function parsePossiblyWrappedJson(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("Shade API returned an empty response.");

  // AEM services sometimes prefix JSON responses. Strip a common anti-XSSI
  // prefix before parsing.
  const cleaned = trimmed.replace(/^\)\]\}'\s*,?\s*/, "");
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    throw new Error(`Shade API did not return valid JSON. First characters: ${cleaned.slice(0, 80)}`);
  }
}

function extractShadeObjects(payload) {
  const result = [];
  const seen = new WeakSet();

  function walk(node, context = {}) {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      node.forEach(child => walk(child, context));
      return;
    }

    const nextContext = {
      ...context,
      family: readAny(node, [
        "shadeFamily", "shadefamily", "shadeFamilyName", "family", "familyName", "colourFamily",
        "colorFamily", "colourFamilyName", "colorFamilyName", "filterName", "category", "categoryName",
        "shadeGroup", "shadeGroupName", "groupName", "shade_family", "entityType"
      ]) || context.family
    };

    if (looksLikeShade(node)) {
      result.push({ ...node, __contextFamily: nextContext.family || context.family });
    }

    Object.entries(node).forEach(([key, value]) => {
      let childContext = nextContext;
      if (typeof value === "object" && value) {
        const prettyKey = prettifyKey(key);
        if (isLikelyFamilyName(prettyKey)) childContext = { ...nextContext, family: prettyKey };
      }
      walk(value, childContext);
    });
  }

  walk(payload);
  return result;
}

function looksLikeShade(obj) {
  const hasNameOrCode = Boolean(readAny(obj, [
    "shadeName", "shade_name", "shadename", "name", "colourName", "colorName", "title", "shadeTitle", "label", "shade", "displayName", "productName", "colorLabel", "colourLabel", "entityName"
  ]) || readAny(obj, [
    "shadeCode", "shade_code", "code", "shadeNo", "shadeNumber", "colourCode", "colorCode", "shadeId", "id", "entityCode"
  ]));
  const hasColor = Boolean(extractHex(obj) || readAny(obj, ["rgb", "shadeRGB", "shadeRgb", "rgbValue", "colorRgb", "colourRgb"]));
  return hasNameOrCode && hasColor;
}

function normalizeShade(obj, index) {
  const hex = normalizeHex(extractHex(obj));
  if (!hex) return null;

  const code = cleanText(readAny(obj, [
    "shadeCode", "shade_code", "shadecode", "code", "shadeNo", "shadeNumber", "shadeNbr", "shadeNum", "colourCode", "colorCode", "colour_code", "color_code", "shadeId", "id", "sapCode", "sku", "colorId", "colourId", "entityCode"
  ])) || `C${String(index + 1).padStart(4, "0")}`;

  const name = cleanText(readAny(obj, [
    "shadeName", "shade_name", "shadename", "name", "colourName", "colorName", "title", "shadeTitle", "label", "shade", "displayName", "productName", "colorLabel", "colourLabel", "entityName"
  ])) || `Shade ${code}`;

  const rawFamily = cleanText(readAny(obj, [
    "shadeFamily", "shadefamily", "shadeFamilyName", "family", "familyName", "colourFamily", "colorFamily",
    "colourFamilyName", "colorFamilyName", "filterName", "category", "categoryName", "shadeGroup", "shadeGroupName", "groupName", "shade_family", "entityType"
  ]) || obj.__contextFamily) || autoFamily(hex);
  const normalizedFamily = normalizeFamily(rawFamily);
  const family = normalizedFamily === "All" ? autoFamily(hex) : normalizedFamily;

  const rgb = hexToRgb(hex);
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const pageNumber = cleanText(readAny(obj, ["pageNumber", "page_number", "pageNo", "page"]));
  const pageUrl = cleanUrl(readAny(obj, ["pageUrl", "sourceUrl", "shadeUrl", "url", "entityUrl"]));
  const positionNumber = parseInt(cleanText(readAny(obj, ["positionNumber", "position_number", "positionNo", "position"])), 10);
  const popularity = parseInt(cleanText(readAny(obj, ["popularity", "latest"])), 10);
  const latest = parseInt(cleanText(readAny(obj, ["latest"])), 10);
  const featureTag = cleanText(readAny(obj, ["featureTag", "tag", "badge"]));

  return {
    id: `${slugify(code)}-${slugify(name)}-${index}`,
    name,
    code: String(code).trim(),
    hex,
    family,
    rgb,
    rgbText: `${rgb.r}, ${rgb.g}, ${rgb.b}`,
    hsl,
    pageNumber,
    pageUrl,
    sourceUrl: pageUrl || cleanUrl(obj.sourceUrl) || "",
    positionNumber: Number.isFinite(positionNumber) ? positionNumber : index + 1,
    popularity: Number.isFinite(popularity) ? popularity : index + 1,
    latest: Number.isFinite(latest) ? latest : 0,
    featureTag,
    estimated: Boolean(obj.estimated || obj.isApprox),
    isApprox: Boolean(obj.isApprox || obj.estimated),
    source: obj.source || "apcatalogue",
    search: `${name} ${code} ${family} page ${pageNumber}`.toLowerCase()
  };
}

function prepareShadeList(list) {
  const deduped = [];
  const seen = new Set();
  list.forEach((shade, index) => {
    const normalized = shade.rgb ? shade : normalizeShade(shade, index);
    if (!normalized) return;
    const key = `${normalized.code}|${normalized.name}|${normalized.hex}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push({ ...normalized, id: normalized.id || `${slugify(normalized.code)}-${index}` });
  });

  return deduped.sort((a, b) => {
    const familyCompare = a.family.localeCompare(b.family);
    if (familyCompare !== 0) return familyCompare;
    return a.name.localeCompare(b.name);
  });
}

function extractHex(obj) {
  const direct = readAny(obj, [
    "hex", "hexCode", "hexcode", "shadeHex", "shadeHexCode", "shadeHexadecimalCode", "hexadecimal", "hexadecimalCode", "colorHex", "colourHex", "colorHexCode", "colourHexCode", "htmlColor", "htmlColour",
    "rgbHexCode", "rgbHex", "webHex", "swatchHex", "shadeRGB", "shadeRgb", "rgb", "rgbValue", "rgbCode", "rgbcode", "rgb_code", "shadeRGBValue", "shadeRgbValue", "colorRgb", "colourRgb", "colorRGB", "colourRGB", "shadeColor", "shadeColour", "background", "backgroundColor", "bgColor", "color", "colour", "value"
  ]);

  if (Array.isArray(direct)) return rgbArrayToHex(direct);
  if (typeof direct === "object" && direct) {
    const nestedHex = readAny(direct, ["hex", "hexCode", "value", "color", "colour"]);
    if (nestedHex) return nestedHex;
    if (["r", "g", "b"].every(key => key in direct)) return rgbToHex(Number(direct.r), Number(direct.g), Number(direct.b));
    if (["red", "green", "blue"].every(key => key in direct)) return rgbToHex(Number(direct.red), Number(direct.green), Number(direct.blue));
  }
  if (typeof direct === "string") {
    if (/rgb\s*\(/i.test(direct)) return rgbStringToHex(direct);
    const numericTriple = direct.match(/^\s*(\d{1,3})\s*[,| ]\s*(\d{1,3})\s*[,| ]\s*(\d{1,3})\s*$/);
    if (numericTriple) return rgbToHex(Number(numericTriple[1]), Number(numericTriple[2]), Number(numericTriple[3]));
    const styleHex = direct.match(/background(?:-color)?\s*:\s*(#[0-9a-f]{3,8}|rgba?\([^)]+\))/i)?.[1];
    if (styleHex) return /rgb\s*\(/i.test(styleHex) ? rgbStringToHex(styleHex) : styleHex;
    const embeddedHex = direct.match(/#[0-9a-f]{3}(?:[0-9a-f]{3})?\b/i)?.[0] || direct.match(/\b[0-9a-f]{6}\b/i)?.[0];
    return embeddedHex || direct;
  }

  const triples = [
    ["r", "g", "b"],
    ["R", "G", "B"],
    ["red", "green", "blue"],
    ["Red", "Green", "Blue"],
    ["shadeR", "shadeG", "shadeB"],
    ["shadeRed", "shadeGreen", "shadeBlue"],
    ["redValue", "greenValue", "blueValue"],
    ["rValue", "gValue", "bValue"]
  ];

  for (const [rk, gk, bk] of triples) {
    const r = readAny(obj, [rk]);
    const g = readAny(obj, [gk]);
    const b = readAny(obj, [bk]);
    if ([r, g, b].every(value => value !== null && value !== undefined && value !== "" && !Number.isNaN(Number(value)))) {
      return rgbToHex(Number(r), Number(g), Number(b));
    }
  }

  return null;
}

function readAny(obj, keys) {
  if (!obj || typeof obj !== "object") return null;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== null && obj[key] !== undefined && obj[key] !== "") return obj[key];
  }
  const lowerMap = Object.keys(obj).reduce((acc, key) => {
    acc[key.toLowerCase()] = key;
    return acc;
  }, {});
  for (const key of keys) {
    const actual = lowerMap[key.toLowerCase()];
    if (actual && obj[actual] !== null && obj[actual] !== undefined && obj[actual] !== "") return obj[actual];
  }
  return null;
}

// Builds colour-family chips from the API response; no family list is hardcoded in HTML.
function buildCategoryTabs() {
  const familyCounts = new Map();
  state.all.forEach(shade => familyCounts.set(shade.family, (familyCounts.get(shade.family) || 0) + 1));
  const families = [...familyCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([family]) => family);
  const trendingFamilies = new Set(families.slice(0, 5));

  const tabs = ["All", ...families].map((family, index) => {
    const count = index === 0 ? state.all.length : familyCounts.get(family);
    const accent = familyAccent(family);
    const soft = shiftColor(accent, 34, -12);
    const deep = shiftColor(accent, -12, 6);
    const classes = ["tab", index === 0 ? "active" : "", index > 0 && trendingFamilies.has(family) ? "trending" : ""].filter(Boolean).join(" ");
    return `<button class="${classes}" type="button" role="tab" data-family="${escapeAttr(family)}" aria-selected="${index === 0}" style="--tab-accent:${accent};--tab-soft:${soft};--tab-deep:${deep};--tab-shadow:${hexToRgba(accent, .24)}">
      <span class="tab-dot" aria-hidden="true"></span>
      <span class="tab-label">${escapeHtml(family)}</span>
      <em>${count}</em>
    </button>`;
  }).join("");

  dom.tabs.html(tabs);
  dom.tabs.off("click", ".tab").on("click", ".tab", function () {
    applyFilter($(this).data("family"));
  });
}

function applyFilter(family, options = {}) {
  state.category = family || "All";
  state.favoritesOnly = false;
  updateShortlistToggle();

  dom.tabs.find(".tab").removeClass("active").attr("aria-selected", "false");
  dom.tabs.find(".tab").filter((_, tab) => $(tab).data("family") === state.category).addClass("active").attr("aria-selected", "true");

  state.filtered = state.category === "All"
    ? [...state.all]
    : state.all.filter(shade => shade.family === state.category);

  resetSelectionAfterFilter(options);
}

function toggleFavoritesFilter() {
  // The old button name was “Favorites”. It now behaves as a clearer
  // “Shortlisted” filter, using the same colours shown in the header CTA.
  state.favoritesOnly = !state.favoritesOnly;
  updateShortlistToggle();

  if (state.favoritesOnly) {
    const shortlistedIds = getShortlistedShadeIds();
    state.filtered = state.all.filter(shade => shortlistedIds.has(shade.id));
    if (!state.filtered.length) {
      showToast("No shortlisted shades yet. Tap + on a fan strip or Save shade first.");
      state.favoritesOnly = false;
      updateShortlistToggle();
      applyFilter(state.category, { silent: true });
      return;
    }
    dom.tabs.find(".tab").removeClass("active").attr("aria-selected", "false");
    resetSelectionAfterFilter();
  } else {
    applyFilter(state.category, { silent: true });
  }
}

function resetSelectionAfterFilter(options = {}) {
  if (!state.filtered.length) {
    state.selectedIndex = 0;
    state.selectedId = null;
    renderDeck({ animate: false });
    syncUi();
    return;
  }
  const preservedIndex = state.selectedId ? state.filtered.findIndex(shade => shade.id === state.selectedId) : -1;
  state.selectedIndex = preservedIndex >= 0 ? preservedIndex : 0;
  state.selectedId = state.filtered[state.selectedIndex].id;
  dom.range.attr({ min: 0, max: Math.max(0, state.filtered.length - 1) });
  renderDeck({ animate: !options.silent });
  syncUi();
}

function setSelectedIndex(index, options = {}) {
  if (!state.filtered.length) return;
  const nextIndex = clamp(Math.round(index), 0, state.filtered.length - 1);
  if (nextIndex === state.selectedIndex && options.source !== "force") {
    syncUi();
    return;
  }
  state.selectedIndex = nextIndex;
  state.selectedId = state.filtered[nextIndex].id;
  const animate = !["range", "scroll", "drag", "touch-swipe"].includes(options.source);
  renderDeck({ animate });
  syncUi();
}

function selectById(id, options = {}) {
  if (!id) return;
  let index = state.filtered.findIndex(shade => shade.id === id);
  const shade = state.all.find(item => item.id === id);

  if (index < 0 && shade) {
    if (state.favoritesOnly) toggleFavoritesFilter();
    if (state.category !== "All" && shade.family !== state.category) {
      applyFilter(shade.family, { silent: true });
    }
    index = state.filtered.findIndex(item => item.id === id);
  }

  if (index >= 0) {
    setSelectedIndex(index, { source: options.source || "select" });
    if (options.open) openModal(getSelectedShade());
  }
}

function stepShade(step) {
  setSelectedIndex(state.selectedIndex + step, { source: "step" });
}

function renderDeck(options = {}) {
  const shades = state.filtered;
  const selectedShade = getSelectedShade();

  if (!shades.length) {
    state.deckWindow = { key: "", start: 0, end: 0 };
    dom.fanDeck.html(`<div class="empty-tray">No shades available in apcatalogue.json</div>`);
    return;
  }

  const maxCards = window.matchMedia("(max-width: 820px)").matches ? MAX_CARDS_MOBILE : MAX_CARDS_DESKTOP;
  const visibleCount = Math.min(maxCards, shades.length);
  const windowKey = deckWindowKey(shades, visibleCount);
  const { start, end } = computeDeckWindow(shades, visibleCount, windowKey);
  const centerSlot = state.selectedIndex - start;
  const maxSpread = window.matchMedia("(max-width: 820px)").matches ? 50 : 58;
  const gap = visibleCount > 1 ? Math.min(5.1, (maxSpread * 2) / Math.max(1, visibleCount - 1)) : 0;

  const sameWindow = !options.force
    && state.deckWindow.key === windowKey
    && state.deckWindow.start === start
    && state.deckWindow.end === end
    && dom.fanDeck.find(".fan-card").length === end - start;

  // For mobile swipes, updating existing DOM nodes avoids the blink caused by
  // deleting/recreating 30+ cards on every shade step.
  if (sameWindow) {
    updateDeckCardStates({ shades, start, end, centerSlot, gap, selectedShade, animate: options.animate !== false });
    return;
  }

  const html = [];
  for (let slot = 0; slot < end - start; slot += 1) {
    html.push(fanCardMarkup(shades[start + slot], slot, { start, centerSlot, gap, selectedShade }));
  }

  dom.fanDeck.html(html.join(""));
  state.deckWindow = { key: windowKey, start, end };
  animateDeckSpin(options.animate !== false);

  if (window.gsap && options.animate !== false && !state.isDragging) {
    gsap.fromTo(dom.fanDeck.find(".fan-card"),
      { y: 18, opacity: 0.75 },
      { y: 0, opacity: 1, duration: 0.42, ease: "power3.out", stagger: { each: 0.006, from: "center" } }
    );
  }
}

function findShadeById(id) {
  if (!id) return null;
  return state.all.find(item => item.id === id) || null;
}

function findFilteredIndexById(id) {
  if (!id) return -1;
  return state.filtered.findIndex(item => item.id === id);
}

function compareFanPageShade(a, b) {
  const posA = Number(a.positionNumber) || 9999;
  const posB = Number(b.positionNumber) || 9999;
  if (posA !== posB) return posA - posB;

  const popA = Number(a.popularity) || 9999;
  const popB = Number(b.popularity) || 9999;
  if (popA !== popB) return popA - popB;

  return String(a.code || "").localeCompare(String(b.code || ""));
}

function getFanPageShades(shade) {
  if (!shade) return [];

  const pageNumber = cleanText(shade.pageNumber);
  let group = [];

  if (pageNumber) {
    group = state.all.filter(item => cleanText(item.pageNumber) === pageNumber);
  }

  if (!group.length) group = [shade];

  return group.sort(compareFanPageShade).slice(0, 8);
}

function fanSampleMarkup(sample, className, index, selectedShade) {
  const isCurrent = selectedShade && sample.id === selectedShade.id;
  const role = `Shade ${Number(sample.positionNumber) || index + 1}`;

  return `<div class="${className}${isCurrent ? " current-sample" : ""}"
      data-shade-id="${escapeAttr(sample.id)}"
      data-hex="${escapeAttr(sample.hex)}"
      data-code="${escapeAttr(sample.code)}"
      data-family="${escapeAttr(sample.family)}"
      data-role="${escapeAttr(role)}"
      data-label="${escapeAttr(sample.name)}"
      data-url="${escapeAttr(cleanUrl(sample.sourceUrl || sample.pageUrl || ""))}"
      style="background:${sample.hex}">
      <span class="strip-code">${escapeHtml(sample.code)}</span>
      <span class="strip-add" aria-hidden="true">+</span>
    </div>`;
}

function fanCardMarkup(shade, slot, context) {
  const { start, centerSlot, gap, selectedShade } = context;
  const rel = slot - centerSlot;
  const angle = rel * gap;
  const isActive = shade.id === selectedShade?.id;
  const isFavorite = state.favorites.has(shade.id);
  const isShortlisted = isShadeShortlisted(shade);
  const isSaved = isFavorite || isShortlisted;
  const lift = isActive ? -20 : Math.max(-9, -Math.abs(rel) * 0.16);
  const z = 300 - Math.abs(rel);
  const samples = getFanPageShades(shade);
  const sampleHtml = samples.map((sample, index) => fanSampleMarkup(sample, index === 0 ? "card-cap" : "card-strip", index, selectedShade)).join("\n      ");

  return `
    <button class="fan-card${isActive ? " active" : ""}${isFavorite ? " favorite" : ""}${isShortlisted ? " shortlisted" : ""}" type="button"
      data-id="${escapeAttr(shade.id)}"
      data-page="${escapeAttr(shade.pageNumber || "")}"
      data-slot="${start + slot}"
      title="${escapeAttr(`${shade.name} ${shade.code}`)}"
      style="--angle:${angle.toFixed(3)}deg;--lift:${lift}px;--card-bg:${shade.hex};z-index:${z};">
      <span class="card-fav" aria-label="Save ${escapeAttr(shade.name)}"><i class="${isSaved ? "ri-heart-3-fill" : "ri-heart-3-line"}" aria-hidden="true"></i></span>
      ${sampleHtml}
      <span class="card-name">${escapeHtml(shade.name)}</span>
    </button>`;
}

function updateDeckCardStates({ shades, start, end, centerSlot, gap, selectedShade, animate }) {
  dom.fanDeck.find(".fan-card").each(function (slot) {
    const shade = shades[start + slot];
    if (!shade) return;
    const rel = slot - centerSlot;
    const angle = rel * gap;
    const isActive = shade.id === selectedShade?.id;
    const isFavorite = state.favorites.has(shade.id);
    const isShortlisted = isShadeShortlisted(shade);
    const isSaved = isFavorite || isShortlisted;
    const lift = isActive ? -20 : Math.max(-9, -Math.abs(rel) * 0.16);
    const z = 300 - Math.abs(rel);
    const card = $(this);

    this.style.setProperty("--angle", `${angle.toFixed(3)}deg`);
    this.style.setProperty("--lift", `${lift}px`);
    this.style.zIndex = String(z);

    card
      .toggleClass("active", isActive)
      .toggleClass("favorite", isFavorite)
      .toggleClass("shortlisted", isShortlisted)
      .attr("title", `${shade.name} ${shade.code}`)
      .find(".card-fav i")
      .attr("class", isSaved ? "ri-heart-3-fill" : "ri-heart-3-line");

    card.find(".card-cap, .card-strip").each(function () {
      $(this).toggleClass("current-sample", Boolean(selectedShade && String($(this).data("shadeId")) === selectedShade.id));
    });
  });
  animateDeckSpin(animate && !state.isDragging);
}

function animateDeckSpin(animate = true) {
  const shades = state.filtered;
  const spin = ((state.selectedIndex / Math.max(1, shades.length - 1)) * -10) + 5;
  if (window.gsap) {
    gsap.to(dom.fanDeck[0], { "--deck-spin": `${spin}deg`, duration: animate ? 0.35 : 0, ease: "power3.out" });
  } else {
    dom.fanDeck.css("--deck-spin", `${spin}deg`);
  }
}

function deckWindowKey(shades, visibleCount) {
  return [
    state.category,
    state.favoritesOnly ? "fav" : "all",
    visibleCount,
    shades.length,
    shades[0]?.id || "",
    shades[shades.length - 1]?.id || ""
  ].join("|");
}

function computeDeckWindow(shades, visibleCount, windowKey) {
  const maxStart = Math.max(0, shades.length - visibleCount);
  const old = state.deckWindow || { key: "", start: 0, end: 0 };
  const buffer = window.matchMedia("(max-width: 820px)").matches ? 5 : 8;

  if (old.key === windowKey && old.end - old.start === visibleCount) {
    const insideBufferedWindow = state.selectedIndex >= old.start + buffer && state.selectedIndex < old.end - buffer;
    if (insideBufferedWindow) return { start: old.start, end: old.end };
  }

  const half = Math.floor(visibleCount / 2);
  let start = clamp(state.selectedIndex - half, 0, maxStart);
  let end = Math.min(start + visibleCount, shades.length);
  start = Math.max(0, end - visibleCount);
  return { start, end };
}

function syncUi() {
  const shade = getSelectedShade();
  const total = state.filtered.length;
  const index = total ? state.selectedIndex + 1 : 0;
  const progress = total > 1 ? state.selectedIndex / (total - 1) : 0;

  dom.range.attr({ min: 0, max: Math.max(0, total - 1) }).val(state.selectedIndex);
  dom.rangeCount.text(`${index} / ${total}`);
  dom.progressText.text(shade ? `${shade.name} · ${shade.code}` : "No shade selected");
  dom.shadeTotal.text(`${total} shade${total === 1 ? "" : "s"}`);
  dom.progressFill.css("width", `${progress * 100}%`);
  dom.progressKnob.css("left", `${progress * 100}%`);

  renderSelectedPalette();

  if (!shade) return;

  const textColor = readableText(shade.hex);
  dom.beaconSwatch.css("background", shade.hex);
  dom.beaconName.text(shade.name);
  dom.beaconMeta.text(`${shade.family} · ${shade.code} · ${shade.hex.toUpperCase()}`);
  dom.activeFamily.text(shade.family);
  dom.activeName.text(shade.name);
  dom.activeCode.text(`Shade code ${shade.code}`);
  dom.activeHex.text(shade.hex.toUpperCase());
  ensureInsightCta(shade);
  dom.previewWall.css("--preview-color", shade.hex);
  const shadeShortlisted = isShadeShortlisted(shade);
  dom.favoriteCurrent.toggleClass("active", shadeShortlisted)
    .attr("aria-label", shadeShortlisted ? "Colour already shortlisted" : "Shortlist selected colour")
    .find("i")
    .attr("class", shadeShortlisted ? "ri-heart-3-fill" : "ri-heart-3-line");

  dom.selectedBeacon.css({ color: textColor === "#ffffff" ? "#0f172a" : "#0f172a" });
}

function openModal(shade, options = {}) {
  if (!shade) return;
  closeSelectionModal({ instant: true });

  const modalColour = normalizeModalColour(options.sample || shade);
  state.currentModalColor = modalColour;

  dom.overlay.css("--modal-color", modalColour.hex);
  dom.overlay.find(".shade-modal").css("--modal-color", modalColour.hex);
  dom.modalSwatch.css("--modal-color", modalColour.hex);
  dom.modalFamily.text(modalColour.sampleRole ? `${modalColour.family} · ${modalColour.sampleRole}` : modalColour.family);
  dom.modalShadeName.text(modalColour.name);
  dom.modalShadeCode.text(`Shade code ${modalColour.code}`);
  dom.modalHex.text(modalColour.hex.toUpperCase());
  dom.modalRgb.text(modalColour.rgbText);
  dom.modalCode.text(modalColour.code);
  updateModalShortlistState(modalColour);
  ensureModalCta(modalColour);
  dom.overlay.find(".palette-title small").text("Tap a tile to view it");

  buildSmartPalette(modalColour);
  renderSelectedPalette();
  dom.body.addClass("modal-open");
  dom.overlay.addClass("active").attr("aria-hidden", "false");

  const modalNode = dom.overlay.find(".shade-modal")[0];
  const modalContentNode = dom.overlay.find(".modal-content")[0];
  if (modalNode) modalNode.scrollTop = 0;
  if (modalContentNode) modalContentNode.scrollTop = 0;

  // On real phones, transform-based entrance animations can briefly flash while
  // the browser promotes a large blurred modal layer. Keep the first paint stable
  // on small/touch screens and animate only on larger screens.
  if (prefersStableModal() || !window.gsap) {
    if (modalNode) {
      modalNode.style.opacity = "";
      modalNode.style.transform = "";
    }
    return;
  }

  gsap.killTweensOf(modalNode);
  gsap.fromTo(modalNode, { y: 18, scale: .985, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: .24, ease: "power2.out" });
}

function normalizeModalColour(colour) {
  const hex = normalizeHex(colour?.hex) || "#ffffff";
  const rgb = colour?.rgb || hexToRgb(hex);
  const cleanColour = colour || {};
  return {
    ...cleanColour,
    hex,
    rgb,
    rgbText: cleanColour.rgbText || `${rgb.r}, ${rgb.g}, ${rgb.b}`,
    family: cleanText(cleanColour.family) || "Colour",
    name: cleanText(cleanColour.name) || "Selected colour",
    code: cleanText(cleanColour.code) || "Custom",
    sampleRole: cleanText(cleanColour.sampleRole) || "",
    pageNumber: cleanText(cleanColour.pageNumber) || "",
    positionNumber: Number(cleanColour.positionNumber) || 0,
    pageUrl: cleanUrl(cleanColour.pageUrl || cleanColour.sourceUrl) || "",
    sourceUrl: cleanUrl(cleanColour.sourceUrl || cleanColour.pageUrl) || "",
    baseShadeId: cleanColour.baseShadeId || cleanColour.shadeId || cleanColour.id || null
  };
}

function ensureModalCta(shade) {
  const actions = dom.overlay.find(".modal-actions");
  actions.find(".modal-page-cta").remove();
  if (!shade) return;

  const url = resolveShadeUrl(shade);
  if (!url) return;

  actions.append(`<a class="modal-page-cta secondary-action" href="${escapeAttr(url)}"><i class="ri-arrow-right-up-line" aria-hidden="true"></i> View shade</a>`);
}

function resolveShadeUrl(item, linkedShade) {
  if (!item && !linkedShade) return "";

  const shadeId = item && (item.shadeId || item.id || item.baseShadeId);
  const matchedShade = linkedShade || findShadeById(shadeId) || null;

  return cleanUrl(
    (item && (item.pageUrl || item.sourceUrl || item.url)) ||
    (matchedShade && (matchedShade.pageUrl || matchedShade.sourceUrl || matchedShade.url)) ||
    ""
  );
}

function ensureInsightCta(shade) {
  const grid = $(".insight-card .value-grid");
  if (!grid.length) return;

  let ctaCell = grid.children("div").eq(1);
  if (!ctaCell.length) ctaCell = $('<div class="insight-cta-cell"></div>').appendTo(grid);

  const url = resolveShadeUrl(shade);
  const label = shade && shade.name ? `View ${shade.name}` : "View shade";

  ctaCell
    .addClass("insight-cta-cell")
    .html(url
      ? `<a class="insight-view-shade-cta" href="${escapeAttr(url)}" aria-label="${escapeAttr(label)}"><span>View Shade</span><i class="ri-arrow-right-up-line" aria-hidden="true"></i></a>`
      : `<span class="insight-view-shade-cta disabled" aria-disabled="true"><span>View Shade</span></span>`);
}

function prefersStableModal() {
  return window.matchMedia("(max-width: 820px), (pointer: coarse), (prefers-reduced-motion: reduce)").matches;
}

function closeModal() {
  if (!dom.overlay.hasClass("active")) return;
  const modalNode = dom.overlay.find(".shade-modal")[0];
  const complete = () => {
    dom.overlay.removeClass("active").attr("aria-hidden", "true");
    state.currentModalColor = null;
    if (modalNode) {
      modalNode.style.opacity = "";
      modalNode.style.transform = "";
    }
    if (!dom.selectionOverlay.hasClass("active")) dom.body.removeClass("modal-open");
  };

  if (prefersStableModal() || !window.gsap) {
    complete();
    return;
  }

  gsap.killTweensOf(modalNode);
  gsap.to(modalNode, { y: 14, scale: .99, opacity: 0, duration: .16, ease: "power2.in", onComplete: complete });
}

function openSelectionModal() {
  renderSelectedPalette();
  closeModal();
  dom.body.addClass("modal-open");
  dom.selectionOverlay.addClass("active").attr("aria-hidden", "false");
  const selectionNode = dom.selectionOverlay.find(".selection-modal")[0];
  if (selectionNode) selectionNode.scrollTop = 0;
  if (window.gsap) {
    gsap.fromTo(".selection-modal", { y: 24, scale: .97, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: .34, ease: "power3.out" });
  }
}

function closeSelectionModal(options = {}) {
  if (!dom.selectionOverlay.hasClass("active")) return;
  const complete = () => {
    dom.selectionOverlay.removeClass("active").attr("aria-hidden", "true");
    if (!dom.overlay.hasClass("active")) dom.body.removeClass("modal-open");
  };
  if (options.instant || !window.gsap) {
    complete();
    return;
  }
  gsap.to(".selection-modal", { y: 18, scale: .98, opacity: 0, duration: .2, ease: "power2.in", onComplete: complete });
}

function shortlistShade(shade, origin) {
  if (!shade) return;
  const role = shade.sampleRole || "Shortlisted shade";
  const source = shade.isSample ? "Details popup sample" : "Fan plus";
  savePaletteColor(shadeToPaletteItem(shade, { role, source }), {
    origin,
    toast: (colour, added) => added ? `Shortlisted colour: ${colour.name}.` : `${colour.name} is already shortlisted and moved to the front.`
  });
}

function isShadeShortlisted(shade) {
  if (!shade) return false;
  const baseId = shade.baseShadeId || shade.shadeId || shade.id;
  const exactKey = shade.key || paletteKey(shadeToPaletteItem(shade) || shade);
  return state.selectedPalette.some(item => item.key === exactKey || item.hex === shade.hex || item.shadeId === baseId && !shade.isSample);
}

function updateModalShortlistState(shade) {
  if (!shade || !dom.modalFavorite?.length) return;
  const shortlisted = isShadeShortlisted(shade);
  dom.modalFavorite.toggleClass("saved", shortlisted)
    .html(`<i class="${shortlisted ? "ri-heart-3-fill" : "ri-heart-3-line"}" aria-hidden="true"></i> ${shortlisted ? "Saved" : "Save shade"}`);
}

function modalFanSampleMarkup(sample, activeShade) {
  const isActive = activeShade && sample.id === activeShade.id;
  const url = cleanUrl(sample.sourceUrl || sample.pageUrl || "");

  return `<button class="modal-fan-sample${isActive ? " active" : ""}" type="button"
      data-shade-id="${escapeAttr(sample.id)}"
      data-url="${escapeAttr(url)}"
      style="--tile-bg:${sample.hex};--tile-text:${readableText(sample.hex)};">
      <span class="modal-fan-code">${escapeHtml(sample.code)}</span>
      <span class="modal-fan-name">${escapeHtml(sample.name)}</span>
    </button>`;
}

// Modal palette now shows the real remaining shades from the same catalogue pageNumber.
function buildSmartPalette(shade) {
  if (!shade) {
    state.currentSmartPalette = [];
    dom.smartPalette.empty();
    return;
  }

  const pageShades = getFanPageShades(shade);
  const activeId = shade.shadeId || shade.id;
  const activeShade = findShadeById(activeId) || shade;

  state.currentSmartPalette = pageShades.map(item => shadeToPaletteItem(item, {
    shadeId: item.id,
    role: `Fan page shade ${Number(item.positionNumber) || ""}`,
    source: "Same fan page",
    pageUrl: cleanUrl(item.sourceUrl || item.pageUrl || "")
  }));

  dom.smartPalette.html(`<div class="modal-fan-card" role="group" aria-label="Other shades from this fan card">
    ${pageShades.map(item => modalFanSampleMarkup(item, activeShade)).join("")}
  </div>`);

  dom.smartPalette.off("click", ".modal-fan-sample").on("click", ".modal-fan-sample", function () {
    const shadeId = String($(this).data("shadeId") || "");
    const nextShade = findShadeById(shadeId);
    if (!nextShade) return;

    const index = findFilteredIndexById(nextShade.id);
    if (index >= 0) setSelectedIndex(index, { source: "modal-fan" });
    openModal(nextShade, { sample: nextShade });
  });
}

function toggleFavorite(shade) {
  if (!shade) return;
  const willSave = !state.favorites.has(shade.id);
  if (willSave) {
    state.favorites.add(shade.id);
    savePaletteColor(shadeToPaletteItem(shade, { role: "Favourite shade", source: "Heart" }), { silent: true });
    showToast(`${shade.name} saved.`);
  } else {
    state.favorites.delete(shade.id);
    showToast(`${shade.name} removed from favourites.`);
  }
  haptic();
  persistFavorites();
  renderDeck({ animate: false });
  syncUi();
  if (dom.overlay.hasClass("active")) openModal(getSelectedShade());
}

function loadFavorites() {
  try {
    const stored = JSON.parse(localStorage.getItem(FAVORITE_KEY) || "[]");
    state.favorites = new Set(Array.isArray(stored) ? stored : []);
  } catch (_) {
    state.favorites = new Set();
  }
}

function persistFavorites() {
  localStorage.setItem(FAVORITE_KEY, JSON.stringify([...state.favorites]));
}

function loadSelectedPalette() {
  try {
    const stored = JSON.parse(localStorage.getItem(PALETTE_KEY) || "[]");
    state.selectedPalette = Array.isArray(stored)
      ? stored.map(item => normalizePaletteItem(item)).filter(Boolean).slice(0, MAX_SELECTION)
      : [];
  } catch (_) {
    state.selectedPalette = [];
  }
}

function persistSelectedPalette() {
  localStorage.setItem(PALETTE_KEY, JSON.stringify(state.selectedPalette));
}

function shadeToPaletteItem(shade, overrides = {}) {
  if (!shade) return null;
  const hex = normalizeHex(overrides.hex || shade.hex) || shade.hex;
  return normalizePaletteItem({
    shadeId: overrides.shadeId || shade.baseShadeId || shade.shadeId || shade.id,
    name: overrides.name || shade.name,
    code: overrides.code || shade.code,
    family: overrides.family || shade.family,
    role: overrides.role || shade.sampleRole || "Shade",
    source: overrides.source || shade.source || "Fandeck",
    sourceUrl: cleanUrl(overrides.sourceUrl || overrides.pageUrl || shade.sourceUrl || shade.pageUrl || ""),
    pageUrl: cleanUrl(overrides.pageUrl || overrides.sourceUrl || shade.pageUrl || shade.sourceUrl || ""),
    hex,
    featured: Boolean(overrides.featured),
    wide: Boolean(overrides.wide)
  });
}

function paletteItemFromElement(shade, element) {
  const target = $(element);
  const shadeId = cleanText(target.data("shadeId"));
  const realShade = findShadeById(shadeId) || shade;
  const hex = normalizeHex(target.data("hex")) || realShade.hex || shade.hex;
  const role = cleanText(target.data("role")) || "Fan page shade";
  const name = cleanText(target.data("label")) || realShade.name || shade.name;
  const code = cleanText(target.data("code")) || realShade.code || shade.code;
  const family = cleanText(target.data("family")) || realShade.family || shade.family;
  const url = cleanUrl(target.data("url")) || cleanUrl(realShade.sourceUrl || realShade.pageUrl || "");

  return shadeToPaletteItem(realShade, {
    shadeId: realShade.id || shadeId || shade.id,
    hex,
    role,
    name,
    code,
    family,
    source: "Fan card",
    pageUrl: url,
    sourceUrl: url
  });
}

function shadeSampleFromElement(shade, element) {
  const sample = paletteItemFromElement(shade, element);
  if (!sample) return shade;

  const realShade = findShadeById(sample.shadeId);
  if (realShade) return realShade;

  const rgb = hexToRgb(sample.hex);
  return {
    ...shade,
    id: sample.shadeId || shade.id,
    baseShadeId: shade.id,
    shadeId: sample.shadeId || shade.id,
    name: sample.name,
    code: sample.code,
    family: sample.family,
    sampleRole: sample.role,
    source: sample.source,
    sourceUrl: cleanUrl(sample.sourceUrl || sample.pageUrl || ""),
    pageUrl: cleanUrl(sample.pageUrl || sample.sourceUrl || ""),
    hex: sample.hex,
    rgb,
    rgbText: `${rgb.r}, ${rgb.g}, ${rgb.b}`,
    hsl: rgbToHsl(rgb.r, rgb.g, rgb.b),
    isSample: true,
    key: sample.key,
    search: `${sample.name} ${sample.code} ${sample.family} ${sample.role}`.toLowerCase()
  };
}

function normalizePaletteItem(item) {
  if (!item || !item.hex) return null;
  const hex = normalizeHex(item.hex);
  if (!hex) return null;
  const safe = {
    shadeId: item.shadeId || item.id || null,
    name: cleanText(item.name) || "Selected colour",
    code: cleanText(item.code) || "Custom",
    family: cleanText(item.family) || "Palette",
    role: cleanText(item.role) || "Sample",
    source: cleanText(item.source) || "Palette",
    sourceUrl: cleanUrl(item.sourceUrl || item.pageUrl || item.url) || "",
    pageUrl: cleanUrl(item.pageUrl || item.sourceUrl || item.url) || "",
    hex,
    featured: Boolean(item.featured),
    wide: Boolean(item.wide)
  };
  safe.key = item.key || paletteKey(safe);
  return safe;
}

function paletteKey(item) {
  return `${slugify(item.shadeId || item.code || item.name)}-${normalizeHex(item.hex)?.replace("#", "") || "colour"}-${slugify(item.role || "sample")}`;
}

function hasPaletteColor(keyOrHex) {
  const normalizedHex = normalizeHex(keyOrHex);
  return state.selectedPalette.some(item => normalizedHex ? item.hex === normalizedHex : item.key === keyOrHex);
}

function getModalPaletteBase() {
  return dom.overlay?.hasClass("active") && state.currentModalColor ? state.currentModalColor : getSelectedShade();
}

function savePaletteColor(item, options = {}) {
  const normalized = normalizePaletteItem(item);
  if (!normalized) return;

  const existingIndex = state.selectedPalette.findIndex(color => color.key === normalized.key || color.hex === normalized.hex);
  let added = false;
  if (existingIndex >= 0) {
    state.selectedPalette.splice(existingIndex, 1);
    state.selectedPalette.unshift(normalized);
  } else {
    state.selectedPalette.unshift(normalized);
    added = true;
    if (state.selectedPalette.length > MAX_SELECTION) state.selectedPalette.length = MAX_SELECTION;
  }

  persistSelectedPalette();
  renderSelectedPalette();
  buildSmartPalette(getModalPaletteBase());

  if (!options.silent) {
    const customToast = typeof options.toast === "function" ? options.toast(normalized, added) : options.toast;
    showToast(customToast || (added ? `Shortlisted colour: ${normalized.name}.` : `${normalized.name} moved to the top of your shortlist.`));
  }
  haptic();
  animateSaved(options.origin);
  const savedTile = dom.smartPalette.find(`[data-key="${cssEscape(normalized.key)}"]`);
  if (savedTile.length) animateSaved(savedTile[0]);
  updateModalShortlistState(getModalPaletteBase());
  setTimeout(() => renderDeck({ animate: false }), 180);
  if (options.open) openModal(getSelectedShade());
}

function removePaletteColor(key) {
  const before = state.selectedPalette.length;
  state.selectedPalette = state.selectedPalette.filter(item => item.key !== key);
  if (state.selectedPalette.length === before) return;
  persistSelectedPalette();
  renderSelectedPalette();
  buildSmartPalette(getModalPaletteBase());
  renderDeck({ animate: false });
  updateModalShortlistState(getModalPaletteBase());
  showToast("Colour removed from selection.");
}

function clearSelectedPalette() {
  if (!state.selectedPalette.length) return;
  state.selectedPalette = [];
  persistSelectedPalette();
  renderSelectedPalette();
  buildSmartPalette(getModalPaletteBase());
  renderDeck({ animate: false });
  updateModalShortlistState(getModalPaletteBase());
  showToast("Colour selection cleared.");
}

// Renders the shortlisted colours in both the small tray and the header CTA modal.
function getShortlistedShadeIds() {
  return new Set(state.selectedPalette.map(item => item.shadeId).filter(Boolean));
}

function updateShortlistToggle() {
  if (!dom.toggleFavorites?.length) return;
  const count = getShortlistedShadeIds().size;
  const label = state.favoritesOnly ? "Showing shortlisted" : "Shortlisted";
  dom.toggleFavorites
    .toggleClass("active", state.favoritesOnly)
    .attr("aria-label", state.favoritesOnly ? "Show all shades" : "Show only shortlisted shades")
    .html(`<i class="${state.favoritesOnly ? "ri-bookmark-3-fill" : "ri-bookmark-3-line"}" aria-hidden="true"></i> ${label}${count ? ` <span class="pill-count">${count}</span>` : ""}`);
}

function renderSelectedPalette() {
  const count = state.selectedPalette.length;
  const countText = `${count} colour${count === 1 ? "" : "s"}`;
  if (dom.selectionCount?.length) dom.selectionCount.text(countText);
  if (dom.clearSelection?.length) dom.clearSelection.prop("disabled", count === 0);
  if (dom.paletteHint?.length) {
    dom.paletteHint.text(count ? `${countText} shortlisted. Tap the blue header CTA to review.` : "Tap the + on a fan card, Save shade, or a smart palette tile to shortlist colours.");
  }
  if (dom.selectionBadge?.length) {
    dom.selectionBadge.text(count).toggleClass("hidden", count === 0).addClass("bump");
    clearTimeout(renderSelectedPalette.badgeTimer);
    renderSelectedPalette.badgeTimer = setTimeout(() => dom.selectionBadge.removeClass("bump"), 520);
  }

  const selectionPanel = dom.selectionBento?.closest(".selection-preview");
  if (selectionPanel?.length) selectionPanel.toggleClass("has-selection", count > 0);

  if (dom.selectionBento?.length) {
    if (!count) {
      dom.selectionBento.html(`<div class="empty-selection">No colours shortlisted yet. Tap the + on a fandeck card or a smart palette tile.</div>`);
    } else {
      dom.selectionBento.html(state.selectedPalette.map((item, index) => selectionCardMarkup(item, index)).join(""));
    }
  }

  if (dom.favoriteTray?.length) {
    if (!count) {
      dom.favoriteTray.html(`<span class="empty-tray">No colours shortlisted yet</span>`);
    } else {
      const minis = state.selectedPalette.slice(0, 4).map(item => `
        <button class="selection-mini" type="button" data-shade-id="${escapeAttr(item.shadeId || "")}" title="${escapeAttr(`${item.name} ${item.hex.toUpperCase()}`)}">
          <span class="selection-mini-swatch" style="background:${item.hex}"></span>
          <span class="selection-mini-text"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.hex.toUpperCase())}</small></span>
          <i class="ri-arrow-right-up-line" aria-hidden="true"></i>
        </button>
      `).join("");
      dom.favoriteTray.html(`${minis}<button class="review-selection" type="button"><i class="ri-check-double-line" aria-hidden="true"></i> Review ${count}</button>`);
    }
  }
  updateShortlistToggle();
}

function selectionCardMarkup(item, index) {
    var text = readableText(item.hex);
    var classes = ["selection-card", index === 0 ? "primary" : ""].filter(Boolean).join(" ");
    var linkedShade = findShadeById(item.shadeId);
    
    var url = resolveShadeUrl(item, linkedShade);
    var cta = url
        ? '<a class="tile-cta selection-card-cta" href="' + escapeAttr(url) + '" aria-label="View ' + escapeAttr(item.name) + ' shade details"><span>View shade</span><i class="ri-arrow-right-up-line" aria-hidden="true"></i></a>'
        : '<span class="tile-cta selection-card-cta disabled" aria-disabled="true"><span>Shade details</span></span>';
    return '<article class="' + classes + '" data-shade-id="' + escapeAttr(item.shadeId || '') + '" data-shade-url="' + escapeAttr(url) + '" style="--tile-bg:' + item.hex + ';--tile-text:' + text + ';">' +
        '<button class="remove-selection" type="button" data-key="' + escapeAttr(item.key) + '" aria-label="Remove ' + escapeAttr(item.name) + '"><i class="ri-subtract-line" aria-hidden="true"></i></button>' +
        '<div class="selection-card-copy">' +
            '<span class="tile-role">' + escapeHtml(item.role) + '</span>' +
            '<h3>' + escapeHtml(item.name) + '</h3>' +
            '<p>' + escapeHtml(item.code) + ' · ' + escapeHtml(item.hex.toUpperCase()) + '</p>' +
        '</div>' +
        '<div class="selection-card-action">' + cta + '</div>' +
    '</article>';
}

function animateSaved(origin) {
  if (origin) {
    const node = $(origin);
    node.addClass("just-saved saved-pulse");
    setTimeout(() => node.removeClass("just-saved saved-pulse"), 650);
  }
  if (window.gsap && dom.openDetails?.length) {
    gsap.fromTo(dom.openDetails[0], { scale: .92 }, { scale: 1, duration: .42, ease: "elastic.out(1, .5)" });
  }
}

function haptic() {
  if (navigator.vibrate) navigator.vibrate(18);
}


function handleSearchInput() {
  const query = dom.search.val().trim().toLowerCase();
  state.lastQuery = query;
  dom.clearSearch.toggleClass("hidden", !query);

  if (!query) {
    dom.suggestions.hide().empty();
    return;
  }

  const matches = state.all
    .filter(shade => shade.search.includes(query))
    .slice(0, 9);

  if (!matches.length) {
    dom.suggestions.html(`<div class="suggestion-item"><span></span><strong>No shade found</strong><small>Try a family, colour name, or code.</small></div>`).show();
    return;
  }

  dom.suggestions.html(matches.map(shade => `
    <button class="suggestion-item" type="button" data-id="${escapeAttr(shade.id)}">
      <span class="suggestion-swatch" style="background:${shade.hex}"></span>
      <span><strong>${escapeHtml(shade.name)}</strong><small>${escapeHtml(shade.family)} · ${escapeHtml(shade.hex.toUpperCase())}</small></span>
      <em>${escapeHtml(shade.code)}</em>
    </button>
  `).join("")).show();
}

function clearSearch() {
  dom.search.val("");
  dom.clearSearch.addClass("hidden");
  dom.suggestions.hide().empty();
}

function setupGsapIntro() {
  if (!window.gsap) return;
  gsap.from(".brand, .title-block, .search-wrap, .approve-btn", { y: -18, opacity: 0, duration: .55, ease: "power3.out", stagger: .05 });
  gsap.from(".hero-copy > *, .control-row, .deck-section", { y: 22, opacity: 0, duration: .7, ease: "power3.out", stagger: .08, delay: .08 });
}

// Desktop uses GSAP Draggable; mobile uses the native swipe fallback below.
function setupDraggable() {
  if (state.dragProxy) {
    state.dragProxy.kill();
    state.dragProxy = null;
  }

  dom.fanStage.off(".swipeBrowse");
  const isTouchDevice = window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;

  if (isTouchDevice) {
    setupNativeSwipeBrowsing();
    return;
  }

  if (!window.gsap || !window.Draggable) {
    setupNativeSwipeBrowsing();
    return;
  }

  const proxy = document.createElement("div");
  let startIndex = 0;
  let lastX = 0;
  let hasDragged = false;

  state.dragProxy = Draggable.create(proxy, {
    trigger: dom.fanStage[0],
    type: "x",
    inertia: false,
    allowNativeTouchScrolling: true,
    minimumMovement: 6,
    onPress() {
      state.isDragging = true;
      startIndex = state.selectedIndex;
      lastX = this.x;
      hasDragged = false;
      dom.fanStage.addClass("dragging");
    },
    onDrag() {
      const distance = this.x - lastX;
      if (Math.abs(distance) > 6) hasDragged = true;
      const stepSize = 28;
      const next = startIndex - Math.round(distance / stepSize);
      setSelectedIndex(next, { source: "drag" });
    },
    onRelease() {
      state.isDragging = false;
      dom.fanStage.removeClass("dragging");
      if (hasDragged) state.suppressFanClickUntil = Date.now() + 260;
      gsap.set(proxy, { x: 0 });
    }
  })[0];
}

// Mobile swipe: horizontal movement browses shades; vertical movement scrolls the page.
function setupNativeSwipeBrowsing() {
  const stage = dom.fanStage[0];
  let active = false;
  let horizontal = false;
  let startX = 0;
  let startY = 0;
  let startIndex = 0;
  let pointerId = null;

  function beginSwipe(clientX, clientY, id) {
    active = true;
    horizontal = false;
    pointerId = id;
    startX = clientX;
    startY = clientY;
    startIndex = state.selectedIndex;
    state.isDragging = false;
    if (id !== null && id !== undefined && stage.setPointerCapture) {
      try { stage.setPointerCapture(id); } catch (_) {}
    }
  }

  function moveSwipe(clientX, clientY, event) {
    if (!active) return;
    const dx = clientX - startX;
    const dy = clientY - startY;

    if (!horizontal && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.18) {
      horizontal = true;
      state.isDragging = true;
      dom.fanStage.addClass("dragging");
    }

    if (!horizontal) return;
    if (event && event.preventDefault) event.preventDefault();
    const stepSize = window.matchMedia("(max-width: 520px)").matches ? 28 : 34;
    const next = startIndex - Math.round(dx / stepSize);

    // requestAnimationFrame prevents repeated DOM work during fast touchmove
    // bursts, which is the main cause of mobile card blinking.
    state.swipePendingIndex = next;
    if (!state.swipeFrame) {
      state.swipeFrame = requestAnimationFrame(() => {
        setSelectedIndex(state.swipePendingIndex, { source: "touch-swipe" });
        state.swipeFrame = null;
      });
    }
  }

  function endSwipe() {
    if (!active) return;
    active = false;
    if (horizontal) state.suppressFanClickUntil = Date.now() + 320;
    horizontal = false;
    state.isDragging = false;
    dom.fanStage.removeClass("dragging");
    if (pointerId !== null && pointerId !== undefined && stage.releasePointerCapture) {
      try { stage.releasePointerCapture(pointerId); } catch (_) {}
    }
    if (state.swipeFrame) {
      cancelAnimationFrame(state.swipeFrame);
      state.swipeFrame = null;
      setSelectedIndex(state.swipePendingIndex, { source: "touch-swipe" });
    }
    state.swipePendingIndex = null;
    pointerId = null;
  }

  if (window.PointerEvent) {
    dom.fanStage.on("pointerdown.swipeBrowse", function (event) {
      const e = event.originalEvent;
      if (!e || e.pointerType === "mouse") return;
      beginSwipe(e.clientX, e.clientY, e.pointerId);
    });

    dom.fanStage.on("pointermove.swipeBrowse", function (event) {
      const e = event.originalEvent;
      if (!e) return;
      moveSwipe(e.clientX, e.clientY, event);
    });

    dom.fanStage.on("pointerup.swipeBrowse pointercancel.swipeBrowse pointerleave.swipeBrowse", endSwipe);
    return;
  }

  dom.fanStage.on("touchstart.swipeBrowse", function (event) {
    const touch = event.originalEvent?.touches?.[0];
    if (!touch) return;
    beginSwipe(touch.clientX, touch.clientY, null);
  });

  dom.fanStage.on("touchmove.swipeBrowse", function (event) {
    const touch = event.originalEvent?.touches?.[0];
    if (!touch) return;
    moveSwipe(touch.clientX, touch.clientY, event);
  });

  dom.fanStage.on("touchend.swipeBrowse touchcancel.swipeBrowse", endSwipe);
}

function shouldSuppressFanClick() {
  return state.isDragging || Date.now() < state.suppressFanClickUntil;
}

function pulseDeck() {
  if (!window.gsap) return;
  gsap.fromTo(dom.fanDeck[0], { scale: .97 }, { scale: 1, duration: .55, ease: "elastic.out(1, .6)" });
}

function setLoading(isLoading) {
  if (!isLoading) return;
  dom.progressText.text("Loading local Asian Paints colour catalogue...");
  dom.beaconName.text("Loading shades");
  dom.beaconMeta.text("Reading apcatalogue.json");
}

function showDataError(message) {
  state.all = [];
  state.filtered = [];
  state.selectedId = null;
  dom.tabs.html(`<button class="tab active" type="button">Catalogue unavailable</button>`);
  dom.range.attr({ min: 0, max: 0 }).val(0);
  dom.rangeCount.text("0 / 0");
  dom.progressText.text("Catalogue data unavailable");
  dom.shadeTotal.text("0 shades");
  dom.progressFill.css("width", "0%");
  dom.progressKnob.css("left", "0%");
  dom.beaconName.text("No catalogue shades loaded");
  dom.beaconMeta.text("Check apcatalogue.json");
  dom.activeFamily.text("Catalogue");
  dom.activeName.text("No colours found");
  dom.activeCode.text("The fandeck needs catalogue shade data with HEX/RGB values.");
  dom.activeHex.text("--");
  dom.activeRgb.text("--");
  dom.fanDeck.html(`
    <div class="empty-tray api-empty">
      <strong>Catalogue data needed</strong>
      <span>${escapeHtml(message)}</span>
    </div>
  `);
  renderSelectedPalette();
  setLoading(false);
  showToast("Catalogue unavailable. Check apcatalogue.json and your static server.");
}


function getSelectedShade() {
  return state.filtered[state.selectedIndex] || null;
}

function copyToClipboard(value) {
  if (!value) return;
  const done = () => showToast(`${value} copied.`);
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(String(value)).then(done).catch(() => fallbackCopy(value, done));
  } else {
    fallbackCopy(value, done);
  }
}

function fallbackCopy(value, done) {
  const input = document.createElement("textarea");
  input.value = value;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  document.body.removeChild(input);
  done();
}

function showToast(message) {
  dom.toast.text(message).addClass("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => dom.toast.removeClass("show"), 2200);
}

function debounce(fn, wait) {
  let timer;
  return function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function cleanText(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function cleanUrl(value) {
    if (value === null || value === undefined) {
        return "";
    }

    var url = String(value).replace(/&amp;/g, "&").trim();

    if (!url) {
        return "";
    }

    /*
     * Do not use cleanText() for URLs.
     * Keep hyphenated URL paths like:
     * /colour-catalogue/blue-wall-colours/
     */
    var splitIndex = url.search(/[?#]/);
    var pathPart = splitIndex >= 0 ? url.slice(0, splitIndex) : url;
    var suffixPart = splitIndex >= 0 ? url.slice(splitIndex) : "";

    /*
     * Safety only:
     * If any old saved localStorage value already became .htm,
     * convert it back to .html.
     */
    pathPart = pathPart
        .replace(/\s+/g, "-")
        .replace(/\.htm$/i, ".html");

    return pathPart + suffixPart;
}

function normalizeFamily(family) {
  const text = cleanText(family) || "Other";
  const known = {
    grey: "Grey",
    greys: "Grey",
    gray: "Grey",
    grays: "Grey",
    blue: "Blue",
    blues: "Blue",
    brown: "Brown",
    browns: "Brown",
    red: "Pink And Red",
    reds: "Pink And Red",
    pink: "Pink And Red",
    pinks: "Pink And Red",
    "pink and red": "Pink And Red",
    orange: "Orange",
    oranges: "Orange",
    yellow: "Yellow",
    yellows: "Yellow",
    green: "Green",
    greens: "Green",
    teal: "Teal",
    teals: "Teal",
    purple: "Purple",
    purples: "Purple",
    white: "Whites",
    whites: "Whites",
    "off white": "Off Whites",
    "off whites": "Off Whites",
    neutral: "Neutrals",
    neutrals: "Neutrals"
  };
  const lower = text.toLowerCase();
  return known[lower] || text.replace(/\b\w/g, char => char.toUpperCase());
}

function autoFamily(hex) {
  const { r, g, b } = hexToRgb(hex);
  const { h, s, l } = rgbToHsl(r, g, b);
  if (l > 92 && s < 30) return "Whites";
  if (s < 12) return "Grey";
  if (h >= 345 || h < 14) return "Pink And Red";
  if (h < 42) return "Orange";
  if (h < 68) return "Yellow";
  if (h < 145) return "Green";
  if (h < 188) return "Teal";
  if (h < 245) return "Blue";
  if (h < 304) return "Purple";
  return "Pink And Red";
}

function isLikelyFamilyName(key) {
  const normalized = key.toLowerCase();
  return ["grey", "greys", "gray", "grays", "blue", "blues", "brown", "browns", "red", "reds", "pink", "pinks", "pink and red", "orange", "oranges", "yellow", "yellows", "green", "greens", "teal", "teals", "purple", "purples", "whites", "white", "off whites", "off white", "neutral", "neutrals"].includes(normalized);
}

function prettifyKey(key) {
  return cleanText(key.replace(/([a-z])([A-Z])/g, "$1 $2"));
}

function normalizeHex(value) {
  if (!value) return null;
  let hex = String(value).trim();
  if (/^[0-9a-f]{6}$/i.test(hex)) hex = `#${hex}`;
  if (/^[0-9a-f]{3}$/i.test(hex)) hex = `#${hex}`;
  if (!/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(hex)) return null;
  if (hex.length === 4) {
    hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  return hex.toLowerCase();
}

function hexToRgb(hex) {
  const safe = normalizeHex(hex) || "#000000";
  const value = safe.slice(1);
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16)
  };
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map(num => clamp(Math.round(num), 0, 255).toString(16).padStart(2, "0")).join("")}`;
}

function rgbArrayToHex(arr) {
  if (arr.length < 3) return null;
  return rgbToHex(Number(arr[0]), Number(arr[1]), Number(arr[2]));
}

function rgbStringToHex(value) {
  const matches = String(value).match(/\d+(?:\.\d+)?/g);
  if (!matches || matches.length < 3) return null;
  return rgbToHex(Number(matches[0]), Number(matches[1]), Number(matches[2]));
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > .5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
      default: h = 0;
    }
    h /= 6;
  }

  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  s = clamp(s, 0, 100) / 100;
  l = clamp(l, 0, 100) / 100;

  if (s === 0) {
    const value = Math.round(l * 255);
    return { r: value, g: value, b: value };
  }

  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  const q = l < .5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255)
  };
}

function shiftColor(hex, lightnessDelta = 0, saturationDelta = 0) {
  if (window.tinycolor) {
    const color = tinycolor(hex);
    if (lightnessDelta >= 0) color.lighten(lightnessDelta);
    else color.darken(Math.abs(lightnessDelta));
    if (saturationDelta >= 0) color.saturate(saturationDelta);
    else color.desaturate(Math.abs(saturationDelta));
    return color.toHexString();
  }
  const rgb = hexToRgb(hex);
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const shifted = hslToRgb(hsl.h, hsl.s + saturationDelta, hsl.l + lightnessDelta);
  return rgbToHex(shifted.r, shifted.g, shifted.b);
}

function shiftHue(hex, hueDelta = 0, lightnessDelta = 0, saturationDelta = 0) {
  if (window.tinycolor) {
    const color = tinycolor(hex).spin(hueDelta);
    if (lightnessDelta >= 0) color.lighten(lightnessDelta);
    else color.darken(Math.abs(lightnessDelta));
    if (saturationDelta >= 0) color.saturate(saturationDelta);
    else color.desaturate(Math.abs(saturationDelta));
    return color.toHexString();
  }
  const rgb = hexToRgb(hex);
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const shifted = hslToRgb(hsl.h + hueDelta, hsl.s + saturationDelta, hsl.l + lightnessDelta);
  return rgbToHex(shifted.r, shifted.g, shifted.b);
}

function readableText(hex) {
  const { r, g, b } = hexToRgb(hex);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > .58 ? "#0f172a" : "#ffffff";
}

function familyAccent(family = "All") {
  const lower = String(family).toLowerCase();
  if (lower.includes("all")) return "#ed1c24";
  if (lower.includes("blue")) return "#1d6fb8";
  if (lower.includes("brown")) return "#8b5a3c";
  if (lower.includes("grey") || lower.includes("gray")) return "#64748b";
  if (lower.includes("orange")) return "#f97316";
  if (lower.includes("pink") || lower.includes("red")) return "#db2777";
  if (lower.includes("purple") || lower.includes("violet")) return "#7c3aed";
  if (lower.includes("green")) return "#16a34a";
  if (lower.includes("teal")) return "#0f9f9a";
  if (lower.includes("yellow")) return "#ca8a04";
  if (lower.includes("white")) return "#94a3b8";
  if (lower.includes("neutral")) return "#a16207";
  return "#ed1c24";
}

function hexToRgba(hex, alpha = 1) {
  const rgb = hexToRgb(hex);
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clamp(alpha, 0, 1)})`;
}

function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const convert = value => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * convert(r) + 0.0722 * convert(b) + 0.7152 * convert(g);
}

function contrastRatio(backgroundHex, textHex) {
  const bg = relativeLuminance(backgroundHex);
  const fg = relativeLuminance(textHex);
  const lighter = Math.max(bg, fg);
  const darker = Math.min(bg, fg);
  return (lighter + 0.05) / (darker + 0.05);
}

function contrastGrade(ratio) {
  if (ratio >= 7) return "AAA";
  if (ratio >= 4.5) return "AA";
  if (ratio >= 3) return "Large";
  return "Low";
}

function shortCode(code, offset) {
  const clean = String(code || "").replace(/\s+/g, "");
  if (clean.length <= 6) return offset ? `${clean}` : clean;
  return `${clean.slice(0, 4)}${offset}`;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "shade";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function cssEscape(value) {
  if (window.CSS?.escape) return CSS.escape(String(value));
  return String(value).replace(/"/g, "\\\"");
}

(function () {
  'use strict';

  function initArcSlider() {
    const slider = document.getElementById('rangeSlider');
    if (!slider) return;

    const MIN  = parseFloat(slider.min)  || 0;
    const MAX  = parseFloat(slider.max)  || 100;
    const STEP = parseFloat(slider.step) || 1;

    const SECTIONS = [
      { min: 0,  max: 24,  color: '#E24B4A', bg: '#FCEAEA', icon: 'ti ti-seedling', title: 'Getting started',     desc: "You're at the very beginning. Explore the basics and take your first steps.",  tags: ['Intro', 'Basics', 'Setup']        },
      { min: 25, max: 49,  color: '#EF9F27', bg: '#FDF3E3', icon: 'ti ti-flame',    title: 'Building momentum',   desc: "You've got the hang of it. Build key skills and a consistent daily habit.",    tags: ['Practice', 'Habits', 'Skills']    },
      { min: 50, max: 74,  color: '#1D9E75', bg: '#E6F6F1', icon: 'ti ti-bolt',     title: 'Hitting your stride', desc: "Great progress! Applying what you've learned to real challenges.",             tags: ['Projects', 'Challenges', 'Speed'] },
      { min: 75, max: 100, color: '#5B4CF5', bg: '#ECEAFD', icon: 'ti ti-crown',    title: 'Mastery zone',        desc: "Outstanding! Deep dives, mentorship, and certification are within reach.",    tags: ['Advanced', 'Mastery', 'Certify']  }
    ];

    const CX = 150, CY = 152, R = 124;
    const START_DEG = 210, END_DEG = 330;
    const SPAN    = ((END_DEG - START_DEG) + 360) % 360;
    const ARC_LEN = (SPAN / 360) * 2 * Math.PI * R;

    function deg2rad(d) { return d * Math.PI / 180; }

    function ptOnArc(deg) {
      return {
        x: CX + R * Math.cos(deg2rad(deg)),
        y: CY + R * Math.sin(deg2rad(deg))
      };
    }

    function arcPathD(a1, a2) {
      const s = ptOnArc(a1), e = ptOnArc(a2);
      const sp = ((a2 - a1) + 360) % 360;
      return `M${s.x} ${s.y} A${R} ${R} 0 ${sp > 180 ? 1 : 0} 1 ${e.x} ${e.y}`;
    }

    const bgArc   = document.getElementById('bgArc');
    const fillArc = document.getElementById('fillArc');
    const thumbEl = document.getElementById('thumb');
    const dotEl   = document.getElementById('dot');
    const svgEl   = document.getElementById('arcSvg');
    if (!bgArc || !fillArc || !thumbEl || !dotEl || !svgEl) return;

    bgArc.setAttribute('d', arcPathD(START_DEG, END_DEG));
    fillArc.setAttribute('d', arcPathD(START_DEG, END_DEG));
    fillArc.setAttribute('stroke-dasharray', ARC_LEN);
    fillArc.setAttribute('stroke-dashoffset', ARC_LEN);

    function getSection(v) {
      const pct = ((v - MIN) / (MAX - MIN)) * 100;
      return SECTIONS.find(s => pct >= s.min && pct <= s.max) || SECTIONS[0];
    }

    function update(t) {
      const v   = MIN + t * (MAX - MIN);
      const sec = getSection(v);

      fillArc.setAttribute('stroke-dashoffset', ARC_LEN - t * ARC_LEN);

      const pt = ptOnArc(START_DEG + t * SPAN);
      thumbEl.setAttribute('cx', pt.x); thumbEl.setAttribute('cy', pt.y);
      dotEl.setAttribute('cx',   pt.x); dotEl.setAttribute('cy',   pt.y);
      thumbEl.setAttribute('stroke', sec.color);
      thumbEl.style.filter = `drop-shadow(0 2px 8px ${sec.color}55)`;
      dotEl.setAttribute('fill', sec.color);

      const cvNum = document.getElementById('cvNum');
      if (cvNum) cvNum.textContent = Math.round(v);

      const secCard  = document.getElementById('secCard');
      const secIcon  = document.getElementById('secIcon');
      const secIco   = document.getElementById('secIco');
      const secTitle = document.getElementById('secTitle');
      const secDesc  = document.getElementById('secDesc');
      const secTags  = document.getElementById('secTags');

      if (secCard)  secCard.style.borderColor = sec.color;
      if (secIcon)  secIcon.style.background  = sec.bg;
      if (secIco) { secIco.style.color        = sec.color;
                    secIco.className          = 'ti ' + sec.icon.replace('ti ', ''); }
      if (secTitle) secTitle.textContent      = sec.title;
      if (secDesc)  secDesc.textContent       = sec.desc;
      if (secTags)  secTags.innerHTML         = sec.tags
        .map(tag => `<span class="tag" style="background:${sec.bg};color:${sec.color}">${tag}</span>`)
        .join('');
    }

    function setVal(v) {
      v = Math.max(MIN, Math.min(MAX, Math.round(v / STEP) * STEP));
      slider.value = v;
      slider.dispatchEvent(new Event('input',  { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
      update((v - MIN) / (MAX - MIN));
    }

    slider.addEventListener('input',  () => update((parseFloat(slider.value) - MIN) / (MAX - MIN)));
    slider.addEventListener('change', () => update((parseFloat(slider.value) - MIN) / (MAX - MIN)));

    let dragging = false;

    function pointerToT(e) {
      const rect = svgEl.getBoundingClientRect();
      const px   = ((e.touches ? e.touches[0].clientX : e.clientX) - rect.left) * (300 / rect.width);
      const py   = ((e.touches ? e.touches[0].clientY : e.clientY) - rect.top)  * (155 / rect.height);
      let angle  = Math.atan2(py - CY, px - CX) * 180 / Math.PI;
      if (angle < 0) angle += 360;
      let t = ((angle - START_DEG) + 360) % 360 / SPAN;
      if (t > 0.95) t = 1;
      if (t < 0.05) t = 0;
      return Math.max(0, Math.min(1, t));
    }

    thumbEl.addEventListener('mousedown',  e => { dragging = true; e.preventDefault(); });
    thumbEl.addEventListener('touchstart', e => { dragging = true; e.preventDefault(); }, { passive: false });
    document.addEventListener('mousemove', e => { if (dragging) setVal(MIN + pointerToT(e) * (MAX - MIN)); });
    document.addEventListener('touchmove', e => { if (dragging) setVal(MIN + pointerToT(e) * (MAX - MIN)); }, { passive: false });
    document.addEventListener('mouseup',  () => dragging = false);
    document.addEventListener('touchend', () => dragging = false);
    svgEl.addEventListener('click', e => setVal(MIN + pointerToT(e) * (MAX - MIN)));

    update((parseFloat(slider.value) - MIN) / (MAX - MIN));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initArcSlider);
  } else {
    initArcSlider();
  }

})();