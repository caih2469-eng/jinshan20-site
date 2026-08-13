/*
 * Masonry allocation and card measurement are adapted from:
 * Jamailar/Beav, desktop/src/pages/MediaLibrary.tsx
 *
 * Beav is distributed under “MIT License – Non-Commercial Use Only”.
 * The applicable notice is preserved in THIRD_PARTY_NOTICES.md.
 */
(() => {
  'use strict';

  const GRID_SELECTOR = '.plaza-grid';
  const CARD_SELECTOR = '.plaza-card[data-post]';
  const COLUMN_SELECTOR = '[data-plaza-column]';
  const stateByGrid = new WeakMap();
  const activeGrids = new Set();

  const cardKey = (card) => String(card?.dataset?.post || card?.dataset?.cardIndex || '');

  const sortedCards = (grid) => [...grid.querySelectorAll(CARD_SELECTOR)]
    .sort((left, right) => Number(left.dataset.cardIndex || 0) - Number(right.dataset.cardIndex || 0));

  const inferMediaAspectRatio = (card) => {
    const image = card.querySelector('.plaza-card-cover img');
    const width = Number(image?.naturalWidth || image?.getAttribute?.('width') || 0);
    const height = Number(image?.naturalHeight || image?.getAttribute?.('height') || 0);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return width / height;
    }
    return 3 / 4;
  };

  const estimateMediaCardHeight = (card, columnWidth) => {
    const mediaAspectRatio = inferMediaAspectRatio(card);
    const mediaHeight = columnWidth / mediaAspectRatio;
    const copy = String(card.querySelector('.plaza-card-copy')?.textContent || '').trim();
    const textBlockHeight = copy ? 50 : 0;
    const authorHeight = 34;
    return Math.round(mediaHeight + textBlockHeight + authorHeight);
  };

  const applyNaturalImageLayout = (image) => {
    const cover = image?.closest?.('.plaza-card-cover');
    if (!cover || image.hidden) return;
    const width = Number(image.naturalWidth || image.getAttribute('width') || 0);
    const height = Number(image.naturalHeight || image.getAttribute('height') || 0);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;

    const ratio = width / height;
    cover.style.setProperty('aspect-ratio', String(ratio));
    cover.style.setProperty('min-height', '0');
    cover.dataset.feedRatio = ratio.toFixed(4);
    cover.classList.add('loaded');
    image.style.setProperty('display', 'block');
    image.style.setProperty('width', '100%', 'important');
    image.style.setProperty('height', 'auto', 'important');
  };

  const measureCard = (card, state) => {
    const key = cardKey(card);
    const nextHeight = Math.round(card.getBoundingClientRect().height);
    if (!key || !Number.isFinite(nextHeight) || nextHeight <= 0) return false;
    const previousHeight = state.measuredCardHeights.get(key);
    state.measuredCardHeights.set(key, nextHeight);
    return !Number.isFinite(previousHeight) || Math.abs(previousHeight - nextHeight) > 1;
  };

  const scheduleGrid = (grid) => {
    const state = stateByGrid.get(grid);
    if (!state || state.frame || !grid.isConnected) return;
    state.frame = requestAnimationFrame(() => {
      state.frame = 0;
      layoutGrid(grid);
    });
  };

  const layoutGrid = (grid) => {
    const state = stateByGrid.get(grid);
    const columns = [...grid.querySelectorAll(COLUMN_SELECTOR)];
    const cards = sortedCards(grid);
    if (!state || state.rebalancing || columns.length !== 2 || cards.length === 0) return;

    const horizontalGap = 5;
    const gridWidth = grid.getBoundingClientRect().width || Math.max(320, window.innerWidth - 10);
    const columnWidth = Math.max(120, (gridWidth - horizontalGap) / columns.length);
    const masonryColumns = Array.from({ length: columns.length }, () => []);
    const columnHeights = Array.from({ length: columns.length }, () => 0);

    for (const card of cards) {
      let targetColumnIndex = 0;
      for (let index = 1; index < columnHeights.length; index += 1) {
        if (columnHeights[index] < columnHeights[targetColumnIndex]) {
          targetColumnIndex = index;
        }
      }
      masonryColumns[targetColumnIndex].push(card);
      columnHeights[targetColumnIndex] +=
        (state.measuredCardHeights.get(cardKey(card)) ?? estimateMediaCardHeight(card, columnWidth)) + 10;
    }

    state.rebalancing = true;
    columns.forEach((column, index) => column.replaceChildren(...masonryColumns[index]));
    grid.dataset.estimatedColumnHeights = columnHeights.map((height) => Math.round(height)).join(',');
    state.rebalancing = false;

    requestAnimationFrame(() => {
      let changed = false;
      for (const card of cards) {
        state.resizeObserver.observe(card);
        if (measureCard(card, state)) changed = true;
      }
      if (changed && state.verificationPass < 2) {
        state.verificationPass += 1;
        scheduleGrid(grid);
      } else {
        state.verificationPass = 0;
      }
    });
  };

  const bindGrid = (grid) => {
    if (!(grid instanceof HTMLElement) || stateByGrid.has(grid)) return;
    const state = {
      frame: 0,
      rebalancing: false,
      verificationPass: 0,
      measuredCardHeights: new Map(),
      resizeObserver: null
    };

    state.resizeObserver = new ResizeObserver((entries) => {
      if (state.rebalancing) return;
      let changed = false;
      for (const entry of entries) {
        if (entry.target.matches?.(CARD_SELECTOR) && measureCard(entry.target, state)) changed = true;
      }
      if (changed) scheduleGrid(grid);
    });

    stateByGrid.set(grid, state);
    activeGrids.add(grid);

    grid.addEventListener('load', (event) => {
      const image = event.target;
      if (!(image instanceof HTMLImageElement) || !image.closest('.plaza-card-cover')) return;
      requestAnimationFrame(() => {
        applyNaturalImageLayout(image);
        const card = image.closest(CARD_SELECTOR);
        if (card) measureCard(card, state);
        scheduleGrid(grid);
      });
    }, true);

    grid.addEventListener('error', (event) => {
      if (event.target instanceof HTMLImageElement) scheduleGrid(grid);
    }, true);

    for (const card of sortedCards(grid)) {
      state.resizeObserver.observe(card);
      const image = card.querySelector('.plaza-card-cover img');
      if (image?.complete && image.naturalWidth) applyNaturalImageLayout(image);
    }
    scheduleGrid(grid);
  };

  const scanForGrids = (root = document) => {
    if (root instanceof Element && root.matches(GRID_SELECTOR)) bindGrid(root);
    root.querySelectorAll?.(GRID_SELECTOR).forEach(bindGrid);
  };

  const start = () => {
    scanForGrids();
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (node instanceof Element) scanForGrids(node);
        });
      }
      for (const grid of [...activeGrids]) {
        if (!grid.isConnected) activeGrids.delete(grid);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', () => {
      activeGrids.forEach((grid) => scheduleGrid(grid));
    }, { passive: true });
  };

  window.schedulePlazaMasonryLayout = () => {
    activeGrids.forEach((grid) => scheduleGrid(grid));
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();