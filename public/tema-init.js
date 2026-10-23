/* Aplica o tema escolhido antes da primeira pintura (evita o "pisca" claro->escuro). */
(function () {
  try {
    var escolha = localStorage.getItem('radar-tema'); // 'claro' | 'escuro' | 'sistema' (ou vazio)
    var escuro = escolha === 'escuro' || (escolha !== 'claro' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', escuro ? 'dark' : 'light');
  } catch (e) {
    /* sem armazenamento: o CSS cai no tema do sistema */
  }
})();
