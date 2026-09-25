/* =============================================
   SITE SCALE
   ---------------------------------------------
   The site is designed on a 4K monitor, which lays pages out 2560 CSS px
   wide. A smaller desktop screen (a 14" MacBook is 1512 px) shows the same
   pixel sizes in less room, so everything looks cramped. This zooms the
   whole page by (screen width / 2560), so a laptop sees a proportional
   miniature of the 4K layout - same spacing, same relationships, just
   smaller.

     - 2560 px and wider: no change
     - desktop widths below that: scaled, never below MIN
     - under DESKTOP_MIN (tablets, phones): no change; those widths have
       their own stacked layouts

   Loaded in <head>, before anything paints, so there is no jump.
   ============================================= */
(function () {
  var REF = 2560, MIN = 0.5, DESKTOP_MIN = 1100;
  var root = document.documentElement;
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
