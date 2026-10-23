// Catálogo do front. Ritmos, planos e preços vêm da API (/api/config); aqui ficam
// nichos, perfis, textos e os dados visuais/sonoros de cada ritmo.
window.NICHOS = [
  { id: "pessoa",    cor: "#E8245F", emoji: "💝", titulo: "pra uma pessoa",      sub: "aniversário, declaração, saudade, pedido de desculpa" },
  { id: "empresa",   cor: "#FFC247", emoji: "🏪", titulo: "pro meu negócio",     sub: "jingle de loja, delivery, salão, oficina" },
  { id: "evento",    cor: "#0F9D63", emoji: "🎉", titulo: "casamento ou evento", sub: "15 anos, formatura, louvor, hino de turma" },
  { id: "candidato", cor: "#1B1230", emoji: "🗳️", titulo: "campanha",            sub: "jingle com nome e número" },
  { id: "criador",   cor: "#4FC3F7", emoji: "📱", titulo: "pro meu conteúdo",    sub: "vinheta de podcast, trilha de Reels, abertura de canal" }
];
window.PERFIS = {
  pessoa:    ["mãe", "pai", "meu amor", "filho(a)", "amigo(a)", "avó / avô", "irmão(ã)", "outra"],
  empresa:   ["loja", "restaurante / lanche", "salão / barbearia", "academia", "clínica", "oficina", "igreja", "outro"],
  evento:    ["casamento", "15 anos", "formatura", "aniversário", "louvor", "chá revelação", "outro"],
  candidato: ["vereador(a)", "prefeito(a)", "deputado(a)", "governador(a)", "senador(a)", "outro"],
  criador:   ["podcast", "canal", "perfil de Reels", "rádio / web rádio", "outro"]
};
window.COPY = {
  pessoa:    { t: "Quem vai ganhar a música?", s: "O nome entra na letra e no refrão.", p: "Essa pessoa é...", r: "O que a música precisa dizer pra {n}?", starters: ["é aniversário de ", "quero dizer que ", "sinto saudade de ", "quero pedir desculpas por ", "o apelido é "] },
  empresa:   { t: "Qual o nome do seu negócio?", s: "O nome vai grudar no refrão.", p: "O que você faz?", r: "O que o cliente precisa saber sobre {n}?", starters: ["a promoção é ", "fica em ", "o instagram é @", "o slogan é ", "o diferencial é "] },
  evento:    { t: "Qual o nome do evento ou dos homenageados?", s: "Entra na letra e no refrão.", p: "Que tipo de evento?", r: "O que a música precisa contar sobre {n}?", starters: ["a data é ", "a história começou em ", "a frase deles é ", "o tema é "] },
  candidato: { t: "Qual o nome de urna?", s: "Nome e número entram no refrão.", p: "Qual o cargo?", r: "Qual o recado da campanha de {n}?", starters: ["o slogan é ", "a cidade é ", "a proposta principal é ", "o partido é "] },
  criador:   { t: "Qual o nome do canal ou podcast?", s: "Vira a abertura e o refrão.", p: "Que tipo de conteúdo?", r: "Como {n} quer ser lembrado?", starters: ["o tema é ", "o bordão é ", "o convidado da semana é ", "publico toda "] }
};
// visual + sintetizador de fallback (quando não há amostra MP3 em /samples)
window.RITMO_UI = {
  forro: { emoji: "🪗", bpm: 128, cor: "#F5A300", esc: [0, 2, 4, 7, 9] },
  sertanejo: { emoji: "👢", bpm: 100, cor: "#FF3D7F", esc: [0, 4, 7, 9, 11] },
  pagode: { emoji: "🥁", bpm: 96, cor: "#19C37D", esc: [0, 2, 4, 5, 7, 9] },
  piseiro: { emoji: "🐄", bpm: 140, cor: "#FF7A1A", esc: [0, 3, 5, 7, 10] },
  funk: { emoji: "🎧", bpm: 130, cor: "#7C4DFF", esc: [0, 3, 5, 6, 7] },
  gospel: { emoji: "✝️", bpm: 72, cor: "#4FC3F7", esc: [0, 2, 4, 7, 9] },
  mpb: { emoji: "🎼", bpm: 84, cor: "#FFD166", esc: [0, 2, 3, 7, 10] },
  arrocha: { emoji: "💃", bpm: 90, cor: "#EF476F", esc: [0, 2, 3, 5, 7] },
  axe: { emoji: "🎉", bpm: 120, cor: "#06D6A0", esc: [0, 2, 4, 7, 9] },
  rap: { emoji: "🎤", bpm: 92, cor: "#B8C0FF", esc: [0, 3, 5, 7, 10] },
  pop: { emoji: "⭐", bpm: 112, cor: "#F72585", esc: [0, 2, 4, 7, 9] },
  natal: { emoji: "🎄", bpm: 100, cor: "#2A9D8F", esc: [0, 2, 4, 5, 7, 9, 11] },
  brega: { emoji: "💝", bpm: 88, cor: "#E85D75", esc: [0, 2, 4, 5, 7] },
  samba: { emoji: "🪇", bpm: 104, cor: "#FFB703", esc: [0, 2, 4, 7, 9] },
  eletronica: { emoji: "🎛️", bpm: 126, cor: "#00B4D8", esc: [0, 3, 5, 7, 10] },
  reggae: { emoji: "🇯🇲", bpm: 76, cor: "#2A9D8F", esc: [0, 2, 4, 7, 9] }
};
window.RITMO_POR_NICHO = {
  pessoa:    ["sertanejo", "pagode", "mpb", "arrocha", "forro", "gospel", "pop"],
  empresa:   ["piseiro", "funk", "forro", "sertanejo", "pagode", "pop", "axe"],
  evento:    ["gospel", "mpb", "sertanejo", "pop", "pagode", "axe"],
  candidato: ["forro", "piseiro", "axe", "funk", "sertanejo", "pagode", "rap"],
  criador:   ["funk", "pop", "rap", "piseiro", "mpb", "eletronica"]
};
window.VOZES = [{ id: "fem", nome: "voz feminina" }, { id: "masc", nome: "voz masculina" }, { id: "dupla", nome: "dupla (ele e ela)" }];
window.LOADING = [["Colocando {n} no refrão", "o nome tem que sair cantando no primeiro play."], ["Afinando a letra de {n}", "cada verso feito com o que você contou."], ["Escolhendo os instrumentos", "o ritmo que você pediu, do jeito certo."], ["Gravando a voz", "feito pra {n} não sair da cabeça de ninguém."], ["Mixando as duas versões", "você escolhe a que mais gostar."]];
