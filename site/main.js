// SPDX-License-Identifier: GPL-3.0-or-later
import {Dusk} from './scene.js';

const hero = document.querySelector('.desktop');
new Dusk(document.getElementById('wallpaper'), {pointerTarget: hero});

// top bar clock, like GNOME's
const clock = document.getElementById('clock');
const format = new Intl.DateTimeFormat(undefined, {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'});
const tick = () => {
    const now = new Date();
    clock.textContent = format.format(now);
    clock.dateTime = now.toISOString();
};
tick();
setInterval(tick, 10_000);

// copy buttons
for (const button of document.querySelectorAll('[data-copy]')) {
    button.addEventListener('click', async () => {
        const text = document.getElementById(button.dataset.copy).textContent;
        try {
            await navigator.clipboard.writeText(text);
            button.textContent = 'Copied';
        } catch {
            const range = document.createRange();
            range.selectNodeContents(document.getElementById(button.dataset.copy));
            getSelection().removeAllRanges();
            getSelection().addRange(range);
            button.textContent = 'Press Ctrl+C';
        }
        setTimeout(() => (button.textContent = 'Copy'), 2000);
    });
}

// the pause demo: focusing the window freezes the wallpaper
const mini = document.getElementById('mini');
const win = document.getElementById('mini-window');
const desktopButton = document.getElementById('mini-desktop');
const status = document.getElementById('mini-status');
const frames = document.getElementById('mini-frames');
const scene = new Dusk(document.getElementById('mini-wallpaper'), {
    pointerTarget: mini,
    seed: 21,
    onFrame: n => (frames.textContent = n.toLocaleString()),
});

function focusWindow(focused) {
    mini.classList.toggle('is-paused', focused);
    win.setAttribute('aria-pressed', String(focused));
    if (focused) {
        scene.pause();
        status.textContent = 'Paused. Text Editor has focus.';
    } else {
        scene.play();
        status.textContent = 'Playing. The desktop has focus.';
    }
}

win.addEventListener('click', e => {
    e.stopPropagation();
    focusWindow(true);
});
desktopButton.addEventListener('click', e => {
    e.stopPropagation();
    focusWindow(false);
});
mini.addEventListener('click', () => focusWindow(false));
