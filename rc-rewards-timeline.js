const SDK_URL = "https://static.rechargecdn.com/assets/storefront/recharge-client-1.81.0.min.js";
const TAG_NAME = "rc-rewards-timeline";

function loadSdk() {
  if (window.recharge) return Promise.resolve(window.recharge);

  return new Promise(function (resolve, reject) {
    const script = document.createElement("script");
    script.src = SDK_URL;
    script.onload = function () {
      window.recharge.init({ appName: TAG_NAME });
      resolve(window.recharge);
    };
    script.onerror = function () {
      reject(new Error("Failed to load Recharge SDK"));
    };
    document.head.appendChild(script);
  });
}

function waitForPortalSdk(timeoutMs) {
  if (window.recharge) return Promise.resolve(window.recharge);

  return new Promise(function (resolve) {
    const startedAt = Date.now();
    const timer = setInterval(function () {
      if (window.recharge) {
        clearInterval(timer);
        resolve(window.recharge);
      } else if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        resolve(null);
      }
    }, 200);
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
        state: "locked",
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
  const existing = await waitForPortalSdk(2500);
  const rc = existing || (await loadSdk());
  const session = await rc.auth.loginCustomerPortal();
  const subsResult = await rc.subscription.listSubscriptions(session, {
    limit: 25,
    sort_by: "created_at-asc",
  });
  const subscriptions = (subsResult && subsResult.subscriptions) || [];
  const summaries = [];

  for (const sub of subscriptions) {
    let successfulPayments = 0;

    try {
      const chargesResult = await rc.charge.listCharges(session, {
        purchase_item_id: sub.id,
        status: "success",
        limit: 250,
      });
      successfulPayments = ((chargesResult && chargesResult.charges) || []).length;
    } catch (chargeErr) {
      console.warn("[new-section.js][test] charges error", sub.id, chargeErr);
    }

    summaries.push({
      id: sub.id,
      status: sub.status,
      product_title: sub.product_title,
      successfulPayments: successfulPayments,
    });
  }

  const paymentCount = pickPaymentCount(summaries);
  console.log("[new-section.js][test] successful payments", {
    summaries: summaries,
    paymentCount: paymentCount,
    completedGifts: Math.max(0, paymentCount - 1),
  });

  return paymentCount;
}

let progressLoad = null;

function ensureGiftProgress(force) {
  if (force) progressLoad = null;
  if (!progressLoad) {
    progressLoad = fetchSuccessfulPayments()
      .then(function (count) {
        applyGiftStates(count);
        console.log("[new-section.js][test] gift states", STEPS.map(function (step) {
          return { label: step.label, gift: step.gift, state: step.state };
        }));
        return count;
      })
      .catch(function (err) {
        progressLoad = null;
        console.warn("[new-section.js][test] fetch failed", err);
      });
  }
  return progressLoad;
}

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
    height: 3px;
    background: ${TOKENS.green};
    /* width set inline per completed-step count */
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
  }
  .rt-step--next .rt-circle { background: ${TOKENS.greenBg}; border-color: ${TOKENS.green}; }
  .rt-step--done .rt-circle { border-color: ${TOKENS.green}; }

  .rt-circle img {
    width: 78%;
    height: 78%;
    object-fit: contain;
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
  }

  .rt-label {
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: ${TOKENS.muted};
  }
  .rt-step--next .rt-label { color: ${TOKENS.green}; }

  .rt-gift {
    font-size: 15px;
    font-weight: 700;
    margin-top: 3px;
    color: ${TOKENS.ink};
  }
  .rt-step--locked .rt-gift { color: ${TOKENS.muted}; }

  .rt-sub {
    font-size: 12.5px;
    font-weight: 400;
    color: ${TOKENS.muted};
    margin-top: 2px;
  }
  .rt-step--done .rt-sub { font-weight: 700; color: ${TOKENS.green}; }

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
`;

class RewardsTimeline extends HTMLElement {
  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: "open" });
    this._resizeObserver = null;
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
    this._render();
  }

  _observeSize() {
    this._resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0].contentRect.width;
      this.setAttribute("data-size", width <= MOBILE_BREAKPOINT ? "mobile" : "desktop");
    });
    this._resizeObserver.observe(this);
  }

  _render() {
    if (!STEPS.length) {
      this._shadow.innerHTML = "";
      return;
    }

    const doneCount = STEPS.filter((s) => s.state === "done").length;
    const fillPct =
      STEPS.length > 1 ? Math.min(75, (doneCount / (STEPS.length - 1)) * 75) : 0;

    const stepsHtml = STEPS.map((step) => {
      const circleContent =
        step.img === "badge"
          ? `<span class="rt-badge">${this._escape(step.fallback)}</span>`
          : step.img
          ? `<img src="${this._escape(step.img)}" alt="${this._escape(step.gift)}" loading="lazy" />`
          : `<span class="rt-fallback">${this._escape(step.fallback || "")}</span>`;

      const check = step.state === "done" ? `<span class="rt-check">${CHECK_SVG}</span>` : "";
      const label = step.state === "next" ? "On going month" : step.label;
      const sub = step.state === "done" ? "Received" : step.sub;

      return `
        <div class="rt-step rt-step--${step.state}">
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
        <div class="rt-grid" style="--rt-cols:${STEPS.length}">
          <div class="rt-rail"></div>
          <div class="rt-rail-fill" style="width:${fillPct}%"></div>
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