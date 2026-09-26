/* =============================================
   SITE SCALE
   ---------------------------------------------
   The site is designed on a 4K monitor, which lays pages out 2560 CSS px
   wide. A smaller desktop screen (a 14" MacBook is 1512 px) shows the same
   pixel sizes in less room, so everything looks cramped. This zooms the
   whole page by (screen width / 2560), so a laptop sees a proportional
   miniature of the 4K layout - same spacing, same relationships, just
   smaller.

     - REF px and wider: no change
     - desktop widths below that: scaled, never below MIN
     - under DESKTOP_MIN (tablets, phones): no change; those widths have
       their own stacked layouts

   Loaded in <head>, before anything paints, so there is no jump.
   ============================================= */
(function () {
  /* REF is the width everything is scaled against. 2560 matches the 4K monitor
     exactly, which read as too small on a MacBook; 2000 is the middle ground
     (1535: the home page shows its third preview one-third in view, at any laptop width; a 1512 px MacBook gets 98.5%). Raise it to shrink more, lower to shrink less. */
  var root = document.documentElement;
  /* A page can set its own reference width with <html data-scale-ref="...">.
     The about page uses 2560 so a laptop sees the exact 4K composition. */
  var REF = parseFloat(root.getAttribute('data-scale-ref')) || 1535, MIN = 0.5, DESKTOP_MIN = 1100;
  function apply() {
    var w = window.innerWidth;
    var z = (w >= DESKTOP_MIN && w < REF) ? Math.max(MIN, w / REF) : 1;
    root.style.zoom = z === 1 ? '' : String(z);
    /* vh is zoomed along with everything else, so 100vh would fill only part of
       the screen. --vh is one true percent of the screen height (use as
       calc(100 * var(--vh)) instead of 100vh). */
    root.style.setProperty('--vh', (window.innerHeight / 100 / z) + 'px');
  }
  apply();
  window.addEventListener('resize', apply);
})();
