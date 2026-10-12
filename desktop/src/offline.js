const retry = () => window.vicinityDesktop?.retry();
document.getElementById('retry').addEventListener('click', retry);
// Сами пробуем снова каждые 10 секунд и сразу, когда появилась сеть
setInterval(retry, 10000);
window.addEventListener('online', retry);
