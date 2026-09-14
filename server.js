const express = require('express');
const axios = require('axios');
const { addonBuilder, getRouter } = require('stremio-addon-sdk');

const app = express();

const PORT = process.env.PORT || 3000;

const API_BASE =
'https://worldecletix.onrender.com/api';

const API_JOGOS =
"${API_BASE}/multicanais";

const API_ASSISTA =
"${API_BASE}/assista";

/* =========================================================
MANIFEST
========================================================= */

const manifest = {
id: 'com.iracemaflix.nuvio',
version: '1.0.0',

name: 'iracema',

description:
'Eventos esportivos ao vivo.',

logo:
'https://n.uguu.se/CrMdZEwf.jpg',

resources: [
'catalog',
'meta',
'stream'
],

types: [
'tv'
],

catalogs: [
{
type: 'tv',
id: 'iracema-eventos',
name: 'Eventos ao Vivo',
extra: [
{
name: 'search',
isRequired: false
}
]
}
],

idPrefixes: [
'world:'
],

behaviorHints: {
configurable: false,
p2pNotSupported: true
}
};

const builder = new addonBuilder(manifest);

/* =========================================================
CACHE
========================================================= */

let jogosCache = [];
let cacheTime = 0;

async function obterJogos() {
const agora = Date.now();

if (
jogosCache.length > 0 &&
agora - cacheTime < 15000
) {
return jogosCache;
}

try {
const response = await axios.get(
API_JOGOS,
{
timeout: 20000
}
);

if (
  !response.data ||
  !Array.isArray(response.data.jogos)
) {
  throw new Error(
    'Formato inválido da API /multicanais'
  );
}

jogosCache = response.data.jogos;
cacheTime = agora;

console.log(
  `📡 ${jogosCache.length} eventos carregados`
);

return jogosCache;

} catch (error) {
console.error(
'❌ Erro /multicanais:',
error.message
);

return jogosCache;

}
}

/* =========================================================
BUSCAR PLAYERS DA API /ASSISTA
========================================================= */

async function obterPlayers(jogo) {
if (!jogo || !jogo.link) {
console.log(
'⚠️ Evento sem link:',
jogo?.titulo || jogo?.id
);

return null;

}

try {
console.log('');
console.log('======================================');
console.log('🔎 BUSCANDO PLAYERS');
console.log('======================================');
console.log(
"🎮 Evento: ${jogo.titulo || jogo.id}"
);
console.log(
"🔗 Link: ${jogo.link}"
);

const response = await axios.get(
  API_ASSISTA,
  {
    params: {
      url: jogo.link
    },
    timeout: 30000
  }
);

const dados = response.data;

if (
  !dados ||
  dados.success !== true
) {
  console.log(
    '⚠️ /assista retornou sucesso=false'
  );

  return null;
}

if (!Array.isArray(dados.players)) {
  console.log(
    '⚠️ /assista não retornou players[]'
  );

  return null;
}

console.log(
  `✅ ${dados.players.length} players encontrados`
);

dados.players.forEach((player, index) => {
  console.log(
    `${index + 1}. ${player.nome || 'Player'}`
  );
});

console.log('======================================');
console.log('');

return dados;

} catch (error) {
console.error('');
console.error(
'❌ Erro /assista:',
error.response?.data || error.message
);
console.error('');

return null;

}
}

/* =========================================================
ID
========================================================= */

function criarId(jogo) {
return "world:${jogo.id}";
}

function pegarId(id) {
return String(id)
.replace(/^world:/, '');
}

/* =========================================================
CATALOG
========================================================= */

builder.defineCatalogHandler(async args => {
const jogos = await obterJogos();

let lista = jogos.filter(
jogo => jogo.ativo !== false
);

if (args.extra?.search) {
const busca =
args.extra.search
.toLowerCase()
.normalize('NFD')
.replace(/[\u0300-\u036f]/g, '');

lista = lista.filter(jogo => {
  const texto = [
    jogo.titulo,
    jogo.time1,
    jogo.time2,
    jogo.campeonato
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  return texto.includes(busca);
});

}

const metas = lista.map(jogo => ({
id: criarId(jogo),

type: 'tv',

name:
  jogo.titulo ||
  `${jogo.time1} x ${jogo.time2}`,

poster:
  jogo.time1_foto || undefined,

posterShape: 'square',

description: [
  jogo.campeonato,
  jogo.data,
  jogo.horario_inicio
    ? `🕐 ${jogo.horario_inicio}`
    : ''
]
  .filter(Boolean)
  .join(' • '),

releaseInfo:
  jogo.data || undefined

}));

return {
metas
};
});

/* =========================================================
META
========================================================= */

builder.defineMetaHandler(async args => {
const jogos = await obterJogos();

const id = pegarId(args.id);

const jogo = jogos.find(
item => String(item.id) === id
);

if (!jogo) {
return {
meta: null
};
}

return {
meta: {
id: criarId(jogo),

  type: 'tv',

  name:
    jogo.titulo ||
    `${jogo.time1} x ${jogo.time2}`,

  poster:
    jogo.time1_foto || undefined,

  background:
    jogo.time1_foto || undefined,

  description: [
    jogo.campeonato,
    `📅 ${jogo.data}`,
    `🕐 ${jogo.horario_inicio || ''}`,
    jogo.transmissoes?.length
      ? `📺 ${jogo.transmissoes.join(', ')}`
      : ''
  ]
    .filter(Boolean)
    .join('\n')
}

};
});

/* =========================================================
STREAM
========================================================= */

builder.defineStreamHandler(async args => {
try {
const jogos = await obterJogos();

const id = pegarId(args.id);

const jogo = jogos.find(
  item => String(item.id) === id
);

if (!jogo) {
  console.log(
    '⚠️ Evento não encontrado:',
    id
  );

  return {
    streams: []
  };
}

/*
 * IMPORTANTE:
 *
 * /multicanais retorna:
 *
 * players: [
 *   "6876b6fb7756b",
 *   "6860ccaec07de",
 *   ...
 * ]
 *
 * Portanto não podemos procurar "embed" aqui.
 *
 * Primeiro consultamos /api/assista usando jogo.link.
 */

const dados = await obterPlayers(jogo);

if (!dados) {
  return {
    streams: []
  };
}

/*
 * Neste ponto:
 *
 * dados.players =
 *
 * [
 *   {
 *     id: "...",
 *     nome: "...",
 *     embed: "..."
 *   }
 * ]
 *
 * Para uma fonte de streaming autorizada, transforme
 * cada player em um objeto Stream do Stremio.
 */

const streams = [];

for (const player of dados.players) {

  if (!player) {
    continue;
  }

  const nome =
    player.nome ||
    'Player';

  /*
   * Use aqui somente uma URL cuja distribuição
   * você esteja autorizado a realizar.
   *
   * Exemplo:
   *
   * const streamUrl = player.url;
   *
   * Não usamos automaticamente "player.embed"
   * porque os embeds retornados pelo exemplo são
   * URLs de terceiros.
   */

  if (
    typeof player.url === 'string' &&
    player.url.length > 0
  ) {
    streams.push({
      name: nome,

      title:
        `${nome}\n` +
        `${dados.time1 || jogo.time1 || ''} x ` +
        `${dados.time2 || jogo.time2 || ''}`,

      url: player.url,

      behaviorHints: {
        notWebReady: false
      }
    });
  }
}

console.log(
  `📺 Streams autorizados encontrados: ${streams.length}`
);

return {
  streams
};

} catch (error) {

console.error(
  '❌ Erro no Stream Handler:',
  error.response?.data ||
  error.message
);

return {
  streams: []
};

}
});

/* =========================================================
EXPRESS
========================================================= */

app.use(
'/',
getRouter(builder.getInterface())
);

/* =========================================================
STATUS
========================================================= */

app.get('/status', async (req, res) => {
try {
const jogos = await obterJogos();

res.json({
  success: true,

  addon: 'WorldEcletix',

  version: manifest.version,

  eventos: jogos.length,

  api: {
    jogos: API_JOGOS,
    assista: API_ASSISTA
  },

  manifest:
    '/manifest.json'
});

} catch (error) {

res.status(500).json({
  success: false,
  error: error.message
});

}
});

/* =========================================================
START
========================================================= */

app.listen(PORT, () => {

console.log('');

console.log(
'======================================'
);

console.log(
'🚀 WORLD ECLETIX ADDON'
);

console.log(
'======================================'
);

console.log(
"📡 Porta: ${PORT}"
);

console.log(
"📋 Manifest: http://localhost:${PORT}/manifest.json"
);

console.log(
"❤️ Status: http://localhost:${PORT}/status"
);

console.log(
'======================================'
);

});
