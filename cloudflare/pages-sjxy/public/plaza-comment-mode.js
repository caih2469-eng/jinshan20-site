/*
 * Comment presentation adapted from the comment snapshot fields used by:
 * Jamailar/Beav, Plugin/src/background.js
 *
 * Beav is distributed under “MIT License – Non-Commercial Use Only”.
 * The applicable notice is preserved in THIRD_PARTY_NOTICES.md.
 */
(() => {
  'use strict';

  const PANEL_SELECTOR = '.plaza-detail .comments-panel';
  const ITEM_SELECTOR = '.comment-item[data-comment]';
  const STYLE_ID = 'beav-comment-mode-style';

  const installStyles = () => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .beav-comments-panel {
        margin-top: 22px;
        padding-top: 0;
        border-top: 1px solid #f0f0f2;
        background: #fff;
      }
      .beav-comments-heading {
        display: flex;
        align-items: center;
        min-height: 44px;
        margin: 0;
        padding: 0 2px;
        color: #25262b;
        font-size: 14px;
        line-height: 20px;
        font-weight: 600;
        border-bottom: 1px solid #f4f4f5;
      }
      .beav-comments-heading span {
        margin-left: 4px;
        color: #999;
        font-size: 12px;
        font-weight: 400;
      }
      .beav-comment-list {
        display: grid;
        gap: 0;
      }
      .beav-comment-item {
        display: grid;
        grid-template-columns: 34px minmax(0, 1fr);
        gap: 10px;
        padding: 12px 0;
        border: 0;
        border-bottom: 1px solid #f5f5f6;
        background: transparent;
      }
      .beav-comment-avatar {
        width: 34px;
        height: 34px;
        display: grid;
        place-items: center;
        border-radius: 50%;
        background: linear-gradient(135deg, #ffcf7c, #ff647e);
        color: #fff;
        font-size: 12px;
        font-weight: 600;
        line-height: 1;
      }
      .beav-comment-main {
        min-width: 0;
      }
      .beav-comment-author {
        display: block;
        overflow: hidden;
        color: #666;
        font-size: 12px;
        line-height: 18px;
        font-weight: 500;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      .beav-comment-content {
        margin: 3px 0 5px;
        color: #25262b;
        font-size: 14px;
        line-height: 20px;
        font-weight: 400;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .beav-comment-meta {
        display: flex;
        align-items: center;
        min-height: 20px;
        gap: 10px;
        color: #999;
        font-size: 11px;
        line-height: 18px;
      }
      .beav-comment-meta .delete-comment {
        min-height: 28px;
        margin-left: auto;
        padding: 2px 4px;
        color: #999;
        font-size: 11px;
        background: transparent;
      }
      .beav-comment-composer {
        position: sticky;
        bottom: -20px;
        z-index: 4;
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: end;
        gap: 8px;
        margin: 0 -2px;
        padding: 10px 2px calc(10px + env(safe-area-inset-bottom));
        background: linear-gradient(to bottom, rgba(255,255,255,.94), #fff 22%);
        border-top: 1px solid #f2f2f3;
      }
      .beav-comment-composer textarea {
        width: 100%;
        min-height: 40px;
        max-height: 96px;
        margin: 0;
        padding: 9px 14px;
        resize: none;
        border: 1px solid #ececef;
        border-radius: 20px;
        background: #f6f6f7;
        color: #25262b;
        font-size: 13px;
        line-height: 20px;
        box-shadow: none;
      }
      .beav-comment-composer textarea:focus {
        outline: none;
        border-color: #dedee2;
        background: #fff;
      }
      .beav-comment-composer button {
        min-width: 56px;
        min-height: 38px;
        padding: 8px 14px;
        border-radius: 19px;
        background: #ff2442;
        color: #fff;
        font-size: 13px;
        font-weight: 600;
      }
      .beav-more-comments {
        display: block;
        min-height: 36px;
        margin: 8px auto 0;
        padding: 6px 18px;
        border: 0;
        border-radius: 18px;
        background: #f6f6f7;
        color: #777;
        font-size: 12px;
      }
      .beav-comments-panel .empty-comments {
        margin: 0;
        padding: 28px 0;
        text-align: center;
        color: #aaa;
        font-size: 12px;
      }
      @media (max-width: 620px) {
        .beav-comments-panel {
          margin-left: -2px;
          margin-right: -2px;
        }
        .beav-comment-item {
          grid-template-columns: 32px minmax(0, 1fr);
          gap: 9px;
          padding: 11px 0;
        }
        .beav-comment-avatar {
          width: 32px;
          height: 32px;
        }
      }
    `;
    document.head.appendChild(style);
  };

  const initialFor = (name) => String(name || '同').trim().slice(-1) || '同';

  const enhanceCommentItem = (item) => {
    if (!(item instanceof HTMLElement) || item.dataset.beavCommentReady === 'true') return;
    const legacyHeader = item.querySelector(':scope > div:first-child');
    const authorNode = legacyHeader?.querySelector('strong');
    const timeNode = legacyHeader?.querySelector('.muted');
    const contentNode = item.querySelector(':scope > p');
    if (!authorNode || !contentNode) return;

    const deleteButton = item.querySelector('.delete-comment');
    const avatar = document.createElement('span');
    avatar.className = 'beav-comment-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = initialFor(authorNode.textContent);

    const main = document.createElement('div');
    main.className = 'beav-comment-main';

    authorNode.className = 'beav-comment-author';
    contentNode.className = 'beav-comment-content';

    const meta = document.createElement('div');
    meta.className = 'beav-comment-meta';
    if (timeNode) {
      timeNode.className = 'beav-comment-time';
      meta.appendChild(timeNode);
    }
    if (deleteButton) meta.appendChild(deleteButton);

    main.append(authorNode, contentNode, meta);
    item.replaceChildren(avatar, main);
    item.classList.add('beav-comment-item');
    item.dataset.beavCommentReady = 'true';
  };

  const enhancePanel = (panel) => {
    if (!(panel instanceof HTMLElement)) return;
    installStyles();
    panel.classList.add('beav-comments-panel');

    const heading = panel.querySelector(':scope > h3');
    if (heading) {
      heading.classList.add('beav-comments-heading');
      const count = heading.querySelector('#commentCount');
      if (count && heading.dataset.beavHeadingReady !== 'true') {
        heading.firstChild.textContent = '全部评论 ';
        heading.dataset.beavHeadingReady = 'true';
      }
    }

    const form = panel.querySelector('#commentForm');
    if (form) {
      form.classList.add('beav-comment-composer');
      const textarea = form.querySelector('textarea[name="content"]');
      if (textarea) {
        textarea.placeholder = '说点什么…';
        textarea.setAttribute('rows', '1');
      }
      const submit = form.querySelector('button');
      if (submit && submit.dataset.beavLabelReady !== 'true') {
        submit.textContent = '发送';
        submit.dataset.beavLabelReady = 'true';
      }
    }

    const list = panel.querySelector('#commentList');
    if (list) {
      list.classList.add('beav-comment-list');
      list.setAttribute('role', 'feed');
      list.querySelectorAll(ITEM_SELECTOR).forEach(enhanceCommentItem);
    }

    panel.querySelector('#moreComments')?.classList.add('beav-more-comments');
  };

  const scan = (root = document) => {
    if (root instanceof Element && root.matches(PANEL_SELECTOR)) enhancePanel(root);
    root.querySelectorAll?.(PANEL_SELECTOR).forEach(enhancePanel);
    if (root instanceof Element && root.matches(ITEM_SELECTOR)) enhanceCommentItem(root);
    root.querySelectorAll?.(ITEM_SELECTOR).forEach(enhanceCommentItem);
  };

  const start = () => {
    scan();
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (node instanceof Element) scan(node);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
