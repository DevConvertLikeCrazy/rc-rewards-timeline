const SDK_URL = "https://static.rechargecdn.com/assets/storefront/recharge-client-1.81.0.min.js";
const TAG_NAME = "rc-rewards-timeline";

let sdkLoad = null;

function loadSdk() {
  if (window.recharge) return Promise.resolve(window.recharge);
  if (sdkLoad) return sdkLoad;

  sdkLoad = new Promise(function (resolve, reject) {
    if (window.recharge) {
      resolve(window.recharge);
      return;
    }

    const script = document.createElement("script");
    script.src = SDK_URL;
    script.onload = function () {
      if (!window.recharge) {
        sdkLoad = null;
        reject(new Error("Failed to load Recharge SDK"));
        return;
      }
      try {
        window.recharge.init({ appName: TAG_NAME });
      } catch (err) {
        // Portal may have initialized the same global while this script was loading.
      }
      resolve(window.recharge);
    };
    script.onerror = function () {
      sdkLoad = null;
      reject(new Error("Failed to load Recharge SDK"));
    };
    document.head.appendChild(script);
  });

  return sdkLoad;
}

function getRechargeSdk() {
  if (window.recharge) return Promise.resolve(window.recharge);

  return new Promise(function (resolve, reject) {
    let settled = false;

    const timer = setInterval(function () {
      if (!settled && window.recharge) {
        settled = true;
        clearInterval(timer);
        resolve(window.recharge);
      }
    }, 50);

    loadSdk().then(
      function (rc) {
        if (!settled) {
          settled = true;
          clearInterval(timer);
          resolve(rc);
        }
      },
      function (err) {
        setTimeout(function () {
          if (settled) return;
          settled = true;
          clearInterval(timer);
          if (window.recharge) resolve(window.recharge);
          else reject(err);
        }, 2500);
      }
    );
  });
}

function stepsFromThemeGifts() {
  const gifts = Array.isArray(window.customerPortalGifts) ? window.customerPortalGifts : [];

  return gifts
    .filter(function (gift) {
      return gift && String(gift.title || "").trim();
    })
    .map(function (gift) {
      const title = String(gift.title || "").trim();
      const image = gift.image || "";
      const percentMatch = title.match(/(\d+\s*%)/);
      const isBadge = !image && percentMatch;

      return {
        label: String(gift.month || "").trim(),
        gift: title,
        sub: String(gift.subtitle || "").trim(),
        img: isBadge ? "badge" : image,
        fallback: isBadge ? percentMatch[1].replace(/\s/g, "") : "🎁",
        state: "pending",
      };
    });
}

let STEPS = stepsFromThemeGifts();

function applyGiftStates(successfulPayments) {
  const completed = Math.max(0, successfulPayments - 1);

  STEPS.forEach(function (step, index) {
    if (completed >= STEPS.length) {
      step.state = "done";
    } else if (index < completed) {
      step.state = "done";
    } else if (index === completed) {
      step.state = "next";
    } else {
      step.state = "locked";
    }
  });
}

function fillRatio() {
  if (STEPS.length <= 1) return 0;
  const doneCount = STEPS.filter(function (step) {
    return step.state === "done";
  }).length;
  return Math.min(1, doneCount / (STEPS.length - 1));
}

function pickPaymentCount(summaries) {
  const active = summaries.filter(function (item) {
    return String(item.status).toLowerCase() === "active";
  });
  const pool = active.length ? active : summaries;

  return pool.reduce(function (max, item) {
    return Math.max(max, item.successfulPayments || 0);
  }, 0);
}

async function fetchSuccessfulPayments() {
  const rc = await getRechargeSdk();
  const session = await rc.auth.loginCustomerPortal();
  const subsResult = await rc.subscription.listSubscriptions(session, {
    limit: 25,
    sort_by: "created_at-asc",
  });
  const subscriptions = (subsResult && subsResult.subscriptions) || [];
  const chargeLimit = Math.max(STEPS.length + 1, 2);

  const summaries = await Promise.all(
    subscriptions.map(async function (sub) {
      let successfulPayments = 0;

      try {
        const chargesResult = await rc.charge.listCharges(session, {
          purchase_item_id: sub.id,
          status: "success",
          limit: chargeLimit,
        });
        successfulPayments = ((chargesResult && chargesResult.charges) || []).length;
      } catch (chargeErr) {}

      return {
        id: sub.id,
        status: sub.status,
        product_title: sub.product_title,
        successfulPayments: successfulPayments,
      };
    })
  );

  return pickPaymentCount(summaries);
}

let progressLoad = null;

function ensureGiftProgress(force) {
  if (force) progressLoad = null;
  if (!progressLoad) {
    progressLoad = fetchSuccessfulPayments()
      .then(function (count) {
        applyGiftStates(count);
        return count;
      })
      .catch(function (err) {
        progressLoad = null;
        STEPS.forEach(function (step) {
          if (step.state === "pending") step.state = "locked";
        });
      });
  }
  return progressLoad;
}

ensureGiftProgress();

/**
 * Rewards Timeline — Affinity 2.0 custom extension
 * -------------------------------------------------
 * Ported 1:1 from the "RewardJourney" component in the Flow Portal
 * Redesign mock (same colors, spacing, font, and states), then wrapped as
 * an Affinity 2.0 custom extension (a Web Component) and made responsive.
 *
 * Per Recharge docs (Using custom extensions for Affinity 2.0):
 *   - must be served over HTTPS (or uploaded directly in the Page Builder)
 *   - default export only (no named exports)
 *   - must render within 5s
 *   - tag name: lowercase, must contain a hyphen (set when registering, e.g. rc-rewards-timeline)
 *
 * Gift copy/images come from Theme settings → Customer portal.
 * Step state is derived from successfulPayments - 1 (first charge is
 * the signup payment; gifts start on later months).
 */

/* ---- design tokens, copied from the portal's :root ---- */
const TOKENS = {
  ink: "#211f1b",
  muted: "#5c594f",
  line: "#e0ded7",
  green: "#2fa06a",
  greenBorder: "#82c0a0",
  greenBg: "#eef6f1",
  panel: "#ffffff",
  font: '"Assistant","Helvetica Neue",Helvetica,Arial,sans-serif',
};

/* ---- content: edit this to change copy/images/state ---- */
const HEADING = "Your rewards with your plan";

// Element width (px), not viewport width, below which the 4-column grid
// collapses to a vertical stepper. Element-width based because the Page
// Builder can place this in a narrow "Right column" even on desktop.
const MOBILE_BREAKPOINT = 560;

const CHECK_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`;

const STYLES = `
  :host {
    display: block;
    font-family: ${TOKENS.font};
    box-sizing: border-box;
  }
  *, *::before, *::after { box-sizing: border-box; }

  .rt-card {
    background: ${TOKENS.panel};
    border: 1px solid ${TOKENS.greenBorder};
    border-radius: 5px;
    padding: 26px 30px;
  }

  .rt-heading {
    font-size: 20px;
    font-weight: 800;
    letter-spacing: -0.01em;
    margin: 0 0 26px;
    color: ${TOKENS.ink};
  }

  /* ---------- desktop: 4-column grid with a connecting rail ---------- */
  .rt-grid {
    position: relative;
    display: grid;
    grid-template-columns: repeat(var(--rt-cols, 4), 1fr);
  }
  .rt-rail {
    position: absolute;
    top: 36px;
    left: 12.5%;
    right: 12.5%;
    height: 3px;
    background: ${TOKENS.line};
  }
  .rt-rail-fill {
    position: absolute;
    top: 36px;
    left: 12.5%;
    width: 75%;
    height: 3px;
    background: ${TOKENS.green};
    transform: scaleX(var(--rt-fill, 0));
    transform-origin: left center;
    transition: transform 0.85s cubic-bezier(0.22, 1, 0.36, 1);
  }

  .rt-step {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 12px;
  }

  .rt-circle-wrap { position: relative; width: 74px; height: 74px; }
  .rt-circle {
    width: 74px;
    height: 74px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    background: #fff;
    border: 3px solid ${TOKENS.line};
    transition: border-color 0.45s ease, background-color 0.45s ease, box-shadow 0.45s ease;
    transition-delay: calc(var(--rt-i, 0) * 70ms);
  }
  .rt-step--next .rt-circle { background: ${TOKENS.greenBg}; border-color: ${TOKENS.green}; }
  .rt-step--done .rt-circle { border-color: ${TOKENS.green}; }
  .rt-step--pending .rt-circle {
    animation: rt-pulse 1.6s ease-in-out infinite;
  }

  .rt-circle img {
    width: 78%;
    height: 78%;
    object-fit: contain;
    opacity: 1;
    filter: grayscale(0);
    transition: opacity 0.45s ease, filter 0.45s ease;
    transition-delay: calc(var(--rt-i, 0) * 70ms);
  }
  .rt-step--locked .rt-circle img { opacity: 0.4; filter: grayscale(1); }
  .rt-circle .rt-badge { font-size: 17px; font-weight: 800; color: ${TOKENS.muted}; }
  .rt-circle .rt-fallback { font-size: 22px; }

  .rt-check {
    position: absolute;
    right: -4px;
    bottom: -2px;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: ${TOKENS.green};
    border: 3px solid #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 3;
    animation: rt-check-in 0.35s ease both;
    animation-delay: calc(var(--rt-i, 0) * 70ms);
  }

  .rt-label {
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: ${TOKENS.muted};
    transition: color 0.45s ease;
    transition-delay: calc(var(--rt-i, 0) * 70ms);
  }
  .rt-step--next .rt-label { color: ${TOKENS.green}; }

  .rt-gift {
    font-size: 15px;
    font-weight: 700;
    margin-top: 3px;
    color: ${TOKENS.ink};
    transition: color 0.45s ease;
    transition-delay: calc(var(--rt-i, 0) * 70ms);
  }
  .rt-step--locked .rt-gift { color: ${TOKENS.muted}; }

  .rt-sub {
    font-size: 12.5px;
    font-weight: 400;
    color: ${TOKENS.muted};
    margin-top: 2px;
    transition: color 0.45s ease, font-weight 0.45s ease;
    transition-delay: calc(var(--rt-i, 0) * 70ms);
  }
  .rt-step--done .rt-sub { font-weight: 700; color: ${TOKENS.green}; }

  @keyframes rt-pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(47, 160, 106, 0); }
    50% { box-shadow: 0 0 0 8px rgba(47, 160, 106, 0.12); }
  }
  @keyframes rt-check-in {
    from { transform: scale(0.4); opacity: 0; }
    to { transform: scale(1); opacity: 1; }
  }

  /* ---------- mobile: vertical stepper ---------- */
  :host([data-size="mobile"]) .rt-card { padding: 20px; }
  :host([data-size="mobile"]) .rt-heading { font-size: 18px; margin-bottom: 20px; }

  :host([data-size="mobile"]) .rt-grid {
    display: flex;
    flex-direction: column;
  }
  :host([data-size="mobile"]) .rt-rail,
  :host([data-size="mobile"]) .rt-rail-fill {
    top: 0;
    left: 27px;
    right: auto;
    width: 3px !important;
    height: 95%;
  }
  :host([data-size="mobile"]) .rt-rail-fill {
    transform: scaleY(var(--rt-fill, 0));
    transform-origin: top center;
  }
  :host([data-size="mobile"]) .rt-step {
    flex-direction: row;
    align-items: flex-start;
    text-align: left;
    gap: 16px;
    padding-bottom: 28px;
  }
  :host([data-size="mobile"]) .rt-step:last-child { padding-bottom: 0; }
  :host([data-size="mobile"]) .rt-circle-wrap { width: 56px; height: 56px; flex: none; }
  :host([data-size="mobile"]) .rt-circle { width: 56px; height: 56px; border-width: 2px; }
  :host([data-size="mobile"]) .rt-circle .rt-fallback { font-size: 18px; }
  :host([data-size="mobile"]) .rt-circle .rt-badge { font-size: 14px; }
  :host([data-size="mobile"]) .rt-check { width: 20px; height: 20px; }
  :host([data-size="mobile"]) .rt-content { padding-top: 4px; }

  @media (prefers-reduced-motion: reduce) {
    .rt-step--pending .rt-circle { animation: none; }
    .rt-rail-fill, .rt-circle, .rt-circle img, .rt-label, .rt-gift, .rt-sub, .rt-check {
      transition: none;
      animation: none;
    }
  }
`;

class RewardsTimeline extends HTMLElement {
  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: "open" });
    this._resizeObserver = null;
    this._revealed = false;
  }

  connectedCallback() {
    this._render();
    this._observeSize();
    this._loadProgress();
  }

  disconnectedCallback() {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
  }

  // Called by the Affinity portal when a configured event fires (no data
  // is passed in — re-fetch and re-render here if this needs live data).
  refresh() {
    this._loadProgress(true);
  }

  async _loadProgress(force) {
    await ensureGiftProgress(force);
    if (!this.isConnected) return;

    const reveal = () => {
      if (!this.isConnected) return;
      this._revealed = true;
      if (!this._syncSteps()) this._render();
    };

    if (force && this._revealed) {
      reveal();
      return;
    }

    requestAnimationFrame(() => requestAnimationFrame(reveal));
  }

  _observeSize() {
    this._resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0].contentRect.width;
      this.setAttribute("data-size", width <= MOBILE_BREAKPOINT ? "mobile" : "desktop");
    });
    this._resizeObserver.observe(this);
  }

  _stepState(step) {
    return this._revealed ? step.state : "pending";
  }

  _syncSteps() {
    const grid = this._shadow.querySelector(".rt-grid");
    if (!grid) return false;

    const nodes = grid.querySelectorAll(".rt-step");
    if (nodes.length !== STEPS.length) return false;

    grid.style.setProperty("--rt-fill", String(this._revealed ? fillRatio() : 0));

    STEPS.forEach((step, index) => {
      const el = nodes[index];
      const state = this._stepState(step);
      el.className = `rt-step rt-step--${state}`;
      el.style.setProperty("--rt-i", String(index));

      const wrap = el.querySelector(".rt-circle-wrap");
      let check = wrap && wrap.querySelector(".rt-check");
      if (state === "done") {
        if (!check && wrap) {
          wrap.insertAdjacentHTML("beforeend", `<span class="rt-check">${CHECK_SVG}</span>`);
        }
      } else if (check) {
        check.remove();
      }

      const label = state === "next" ? "On going month" : step.label;
      const sub = state === "done" ? "Received" : step.sub;
      const labelEl = el.querySelector(".rt-label");
      const giftEl = el.querySelector(".rt-gift");
      const contentEl = el.querySelector(".rt-content");
      if (labelEl) labelEl.textContent = label;
      if (giftEl) giftEl.textContent = step.gift;

      let subEl = el.querySelector(".rt-sub");
      if (sub) {
        if (!subEl && contentEl) {
          subEl = document.createElement("div");
          subEl.className = "rt-sub";
          contentEl.appendChild(subEl);
        }
        if (subEl) subEl.textContent = sub;
      } else if (subEl) {
        subEl.remove();
      }
    });

    return true;
  }

  _render() {
    if (!STEPS.length) {
      this._shadow.innerHTML = "";
      return;
    }

    const stepsHtml = STEPS.map((step, index) => {
      const state = this._stepState(step);
      const circleContent =
        step.img === "badge"
          ? `<span class="rt-badge">${this._escape(step.fallback)}</span>`
          : step.img
          ? `<img src="${this._escape(step.img)}" alt="${this._escape(step.gift)}" loading="lazy" />`
          : `<span class="rt-fallback">${this._escape(step.fallback || "")}</span>`;

      const check = state === "done" ? `<span class="rt-check">${CHECK_SVG}</span>` : "";
      const label = state === "next" ? "On going month" : step.label;
      const sub = state === "done" ? "Received" : step.sub;

      return `
        <div class="rt-step rt-step--${state}" style="--rt-i:${index}">
          <div class="rt-circle-wrap">
            <div class="rt-circle">${circleContent}</div>
            ${check}
          </div>
          <div class="rt-content">
            <div class="rt-label">${this._escape(label)}</div>
            <div class="rt-gift">${this._escape(step.gift)}</div>
            ${sub ? `<div class="rt-sub">${this._escape(sub)}</div>` : ""}
          </div>
        </div>
      `;
    }).join("");

    this._shadow.innerHTML = `
      <style>${STYLES}</style>
      <div class="rt-card">
        <div class="rt-heading">${this._escape(HEADING)}</div>
        <div class="rt-grid" style="--rt-cols:${STEPS.length}; --rt-fill:${this._revealed ? fillRatio() : 0}">
          <div class="rt-rail"></div>
          <div class="rt-rail-fill"></div>
          ${stepsHtml}
        </div>
      </div>
    `;
  }

  _escape(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
}


export default RewardsTimeline;

customElements.define('rc-rewards-timeline', RewardsTimeline);