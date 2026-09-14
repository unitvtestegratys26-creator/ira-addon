const express = require('express');
const axios = require('axios');
const { addonBuilder, getRouter } = require('stremio-addon-sdk');

const app = express();

const PORT = process.env.PORT || 3000;

const API_BASE =
  'https://worldecletix.onrender.com/api';

const API_JOGOS =
  `${API_BASE}/multicanais`;

const API_ASSISTA =
  `${API_BASE}/assista?url=`;

/* =========================================================
   MANIFEST
========================================================= */

const manifest = {
  id: 'com.worldecletix.nuvio',
  version: '1.0.0',

  name: 'WorldEcletix',

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
      id: 'worldecletix-eventos',
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
   ID
========================================================= */

function criarId(jogo) {
  return `world:${jogo.id}`;
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

  /*
   * Pesquisa do Stremio/Nuvio
   */
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
  const jogos = await obterJogos();

  const id = pegarId(args.id);

  const jogo = jogos.find(
    item => String(item.id) === id
  );

  if (!jogo) {
    console.log(`❌ Jogo não encontrado: ${id}`);

    return {
      streams: []
    };
  }

  if (!jogo.link) {
    console.log(
      `❌ Jogo ${id} não possui link`
    );

    return {
      streams: []
    };
  }

  try {

    console.log(
      `🔎 Buscando players: ${jogo.link}`
    );

    const urlApi =
      API_ASSISTA +
      encodeURIComponent(jogo.link);

    const response = await axios.get(
      urlApi,
      {
        timeout: 30000
      }
    );

    const data = response.data;

    console.log(
      '📥 Resposta /assista recebida'
    );

    /*
     * A API /assista retorna os players
     */
    const players =
      Array.isArray(data.players)
        ? data.players
        : [];

    console.log(
      `📺 ${players.length} players encontrados`
    );

    const streams = players
      .filter(player =>
        player &&
        typeof player.embed === 'string' &&
        player.embed.startsWith('http')
      )
      .map(player => ({
        name:
          player.nome ||
          'Stream',

        title:
          `${player.nome || 'Stream'}\n` +
          `${jogo.time1 || ''} x ` +
          `${jogo.time2 || ''}`,

        url: player.embed,

        behaviorHints: {
          notWebReady: true
        }
      }));

    console.log(
      `✅ ${streams.length} streams enviados ao Stremio`
    );

    return {
      streams
    };

  } catch (error) {

    console.error(
      '❌ Erro ao buscar /assista:',
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
  const jogos = await obterJogos();

  res.json({
    success: true,
    addon: 'WorldEcletix',
    version: manifest.version,
    eventos: jogos.length,
    manifest:
      `/manifest.json`
  });
});

/* =========================================================
   START
========================================================= */

app.listen(PORT, () => {
  console.log('');
  console.log('======================================');
  console.log('🚀 WORLD ECLETIX ADDON');
  console.log('======================================');
  console.log(
    `📡 Porta: ${PORT}`
  );
  console.log(
    `📋 Manifest: http://localhost:${PORT}/manifest.json`
  );
  console.log(
    `❤️ Status: http://localhost:${PORT}/status`
  );
  console.log('======================================');
});
