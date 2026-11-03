/**
 * 创建单选语言菜单。root 为控件容器，onChange 仅在确认某个语言后调用。
 * 返回 setValue，供初始化与页面文案更新时同步当前语言和选中标记。
 */
export function createLanguagePicker(root, onChange) {
  const trigger = root.querySelector('.language-trigger');
  const current = root.querySelector('#language-current');
  const menu = root.querySelector('.language-menu');
  const options = [...menu.querySelectorAll('[data-locale]')];
  let selected = options[0], search = '', searchedAt = 0;

  function setValue(locale) {
    selected = options.find(option => option.dataset.locale === locale) ?? options[0];
    current.textContent = selected.querySelector('span').textContent;
    current.lang = selected.dataset.locale;
    options.forEach(option => option.setAttribute('aria-selected', String(option === selected)));
  }
  function focusOption(option) {
    option.focus({ preventScroll: true });
    // 只滚动菜单内部，窄横屏打开末尾选项时不推动整页。
    const top = option.offsetTop, bottom = top + option.offsetHeight;
    if (top < menu.scrollTop) menu.scrollTop = top;
    else if (bottom > menu.scrollTop + menu.clientHeight) menu.scrollTop = bottom - menu.clientHeight;
  }
  function open(option = selected) {
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    search = '';
    focusOption(option);
  }
  function close(restoreFocus = false) {
    if (menu.hidden) return;
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    search = '';
    if (restoreFocus) trigger.focus({ preventScroll: true });
  }
  trigger.addEventListener('click', () => menu.hidden ? open() : close(true));
  trigger.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      open();
    }
  });
  menu.addEventListener('click', event => {
    const option = event.target.closest('[data-locale]');
    if (!option || !menu.contains(option)) return;
    // 保留链接在新标签页打开的原生行为，普通切换仍在原位置完成。
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onChange(option.dataset.locale);
    close(true);
  });
  menu.addEventListener('keydown', event => {
    const index = options.indexOf(document.activeElement);
    const destinations = {
      ArrowDown: (index + 1) % options.length,
      ArrowUp: (index - 1 + options.length) % options.length,
      Home: 0,
      End: options.length - 1,
    };
    if (Object.hasOwn(destinations, event.key)) {
      event.preventDefault();
      focusOption(options[destinations[event.key]]);
    } else if (event.key === ' ') {
      event.preventDefault();
      onChange(options[index].dataset.locale);
      close(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'Tab') {
      // 回到入口后交给原生 Tab 顺序处理，避免隐藏菜单后焦点掉回页面开头。
      close(true);
    } else if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const now = performance.now();
      search = (now - searchedAt < 700 ? search : '') + event.key.toLocaleLowerCase();
      searchedAt = now;
      const ordered = [...options.slice(index + 1), ...options.slice(0, index + 1)];
      const find = value => ordered.find(option => option.textContent.trim().toLocaleLowerCase().startsWith(value));
      const match = find(search) ?? find(event.key.toLocaleLowerCase());
      if (match) focusOption(match);
    }
    // Enter 沿用链接的原生 click 行为；浏览选项时不提前切换语言。
  });
  document.addEventListener('pointerdown', event => {
    if (!root.contains(event.target)) close();
  });
  document.addEventListener('focusin', event => {
    if (!root.contains(event.target)) close();
  });
  window.addEventListener('blur', () => close());
  return { setValue };
}
