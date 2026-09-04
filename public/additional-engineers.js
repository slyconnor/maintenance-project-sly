(() => {
  const files = ["additional-engineers-core.js", "open-orders-compact.js"];
  const load = index => {
    if (index >= files.length) return;
    const script = document.createElement("script");
    script.src = files[index];
    script.onload = () => load(index + 1);
    document.head.appendChild(script);
  };
  load(0);
})();
