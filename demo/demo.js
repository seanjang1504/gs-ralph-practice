const film = document.querySelector('#film');
for (const button of document.querySelectorAll('[data-time]')) {
  button.addEventListener('click', () => {
    const seek = () => { film.currentTime = Number(button.dataset.time); };
    if (film.readyState >= 1) seek();
    else { film.addEventListener('loadedmetadata', seek, { once: true }); film.load(); }
  });
}
