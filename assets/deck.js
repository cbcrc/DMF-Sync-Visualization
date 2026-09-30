// deck.js — presentation runtime for the brand deck shell (see theme.css).
//
// Turns a `<div class="deck"> … <section class="slide"> … </div>` document into
// a full-screen, keyboard-driven presentation:
//   • one slide on screen at a time, scaled to fit the viewport (letterboxed);
//   • Space / → / PageDown / ↓  advance, Backspace / ← / PageUp / ↑ go back,
//     Home / End jump to the first / last slide;
//   • advancing first reveals the slide's `.step` elements one by one (reveal.js
//     "fragment" model), then moves to the next slide; going back into a slide
//     shows it fully revealed;
//   • a click on the right advances, a click on the left goes back.
//
// The converter / PDF path never run this — they add `.deck-export` to <html>
// (see theme.css), which reveals every slide and step at once for capture.

(function () {
  var deck = document.querySelector('.deck');
  if (!deck) return;
  var slides = Array.prototype.slice.call(deck.querySelectorAll('.slide'));
  if (!slides.length) return;

  var cur = 0;   // index of the slide on screen
  var step = 0;  // number of steps revealed on the current slide

  var counter = document.createElement('div');
  counter.className = 'deck-counter';
  document.body.appendChild(counter);

  // Steps in document order; `data-step="n"` groups several elements into one
  // reveal (sorted by index), otherwise each `.step` is its own reveal.
  function stepsOf(slide) {
    var els = Array.prototype.slice.call(slide.querySelectorAll('.step'));
    var seen = [], groups = [];
    els.forEach(function (el) {
      var key = el.hasAttribute('data-step') ? el.getAttribute('data-step') : '_' + groups.length;
      var i = seen.indexOf(key);
      if (i < 0) { seen.push(key); groups.push([el]); } else { groups[i].push(el); }
    });
    return groups; // array of element-arrays, one per reveal
  }

  function applySteps(slide, n) {
    stepsOf(slide).forEach(function (group, i) {
      group.forEach(function (el) { el.classList.toggle('is-revealed', i < n); });
    });
  }

  function fit() {
    var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    document.documentElement.style.setProperty('--deck-scale', s);
  }

  function show(i, revealAll) {
    i = Math.max(0, Math.min(slides.length - 1, i));
    slides[cur].classList.remove('is-active');
    cur = i;
    slides[cur].classList.add('is-active');
    step = revealAll ? stepsOf(slides[cur]).length : 0;
    applySteps(slides[cur], step);
    counter.textContent = (cur + 1) + ' / ' + slides.length;
    if (history.replaceState) history.replaceState(null, '', '#' + (cur + 1));
  }

  function next() {
    var total = stepsOf(slides[cur]).length;
    if (step < total) { step++; applySteps(slides[cur], step); }
    else if (cur < slides.length - 1) show(cur + 1, false);
  }

  function prev() {
    if (step > 0) { step--; applySteps(slides[cur], step); }
    else if (cur > 0) show(cur - 1, true);
  }

  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case ' ': case 'PageDown': case 'ArrowRight': case 'ArrowDown':
        e.preventDefault(); next(); break;
      case 'Backspace': case 'PageUp': case 'ArrowLeft': case 'ArrowUp':
        e.preventDefault(); prev(); break;
      case 'Home': e.preventDefault(); show(0, false); break;
      case 'End': e.preventDefault(); show(slides.length - 1, true); break;
    }
  });

  deck.addEventListener('click', function (e) {
    if (e.target.closest('a')) return; // let links work
    if (e.clientX < window.innerWidth * 0.25) prev(); else next();
  });

  window.addEventListener('resize', fit);
  fit();

  var h = parseInt((location.hash || '').replace('#', ''), 10);
  show(isNaN(h) ? 0 : h - 1, false);
})();
