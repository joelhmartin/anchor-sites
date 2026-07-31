/**
 * D1200 — carousel enhancement island (spec:
 * docs/superpowers/specs/2026-07-31-published-page-interactivity.md).
 *
 * A single framework-free inline script the Carousel primitive embeds in its
 * own SSR output. The base carousel is a CSS scroll-snap strip that swipes/
 * scrolls with zero JS; this island progressively adds the three behaviors
 * CSS cannot express: arrow buttons, loop wrap-around, and autoplay.
 *
 * Contract (all load-bearing — tests + the preview CSP hash depend on it):
 *  - EXACT-STRING STABLE. Preview routes allow this script via its sha256
 *    hash (script-src 'sha256-…'); any byte change here must ship with the
 *    server picking up the new hash (it computes the hash from this constant
 *    at module load, so a components-package bump is sufficient — but never
 *    edit dist/ by hand).
 *  - Idempotent: initializes only `[data-ac-carousel]:not([data-ac-ready])`,
 *    so N carousel blocks each embedding the tag never double-bind.
 *  - Progressive: arrows stay CSS-hidden until the root is marked
 *    `data-ac-ready`; where scripts can't run, no dead controls ever render.
 *  - Defensive: full try/catch, feature-checked scrollTo, no-ops cleanly in
 *    jsdom.
 *  - Autoplay honors prefers-reduced-motion, is disabled inside the Studio
 *    inline editor (window.__AC_EDIT_BOOT__), and stops permanently on first
 *    user interaction (Embla stopOnInteraction parity).
 *  - Budget: < 2KB. No React, no dependencies, no </script> sequence.
 */
export const CAROUSEL_ISLAND_JS =
  "(function(){try{" +
  "var roots=document.querySelectorAll('[data-ac-carousel]:not([data-ac-ready])');" +
  "for(var r=0;r<roots.length;r++){(function(root){" +
  "var vp=root.querySelector('[data-ac-viewport]');if(!vp)return;" +
  "root.setAttribute('data-ac-ready','');" +
  "var loop=root.hasAttribute('data-loop');" +
  "var ms=parseInt(root.getAttribute('data-autoplay')||'0',10);" +
  "var prev=root.querySelector('[data-ac-prev]');" +
  "var next=root.querySelector('[data-ac-next]');" +
  "function count(){return vp.children.length}" +
  "function idx(){var w=vp.clientWidth||1;return Math.round(vp.scrollLeft/w)}" +
  "function go(i){var n=count();if(!n)return;" +
  "if(loop){i=(i%n+n)%n}else{i=Math.max(0,Math.min(n-1,i))}" +
  "var left=i*(vp.clientWidth||0);" +
  "if(vp.scrollTo){vp.scrollTo({left:left,behavior:'smooth'})}else{vp.scrollLeft=left}}" +
  "function sync(){if(loop)return;var i=idx(),n=count();" +
  "if(prev)prev.disabled=i<=0;if(next)next.disabled=i>=n-1}" +
  "if(prev)prev.addEventListener('click',function(){go(idx()-1)});" +
  "if(next)next.addEventListener('click',function(){go(idx()+1)});" +
  "vp.addEventListener('scroll',function(){" +
  "if(window.requestAnimationFrame){requestAnimationFrame(sync)}else{sync()}},{passive:true});" +
  "sync();" +
  "if(ms>=1000&&!window.__AC_EDIT_BOOT__&&" +
  "!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches)){" +
  "var t=setInterval(function(){var n=count();var i=idx()+1;" +
  "if(i>=n)i=0;go(i)},ms);" +
  "var stop=function(){clearInterval(t)};" +
  "root.addEventListener('pointerdown',stop,{once:true});" +
  "root.addEventListener('wheel',stop,{once:true,passive:true});" +
  "root.addEventListener('keydown',stop,{once:true});" +
  "root.addEventListener('touchstart',stop,{once:true,passive:true});" +
  "}})(roots[r])}" +
  "}catch(e){}})();";
