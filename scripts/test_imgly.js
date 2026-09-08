const sharp = require('sharp');
const { removeBackground } = require('@imgly/background-removal-node');

async function test() {
  console.log('Gerando imagem de teste...');
  const inputBuffer = await sharp({
    create: {
      width: 200,
      height: 200,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    }
  }).composite([{
    input: Buffer.from('<svg width="100" height="100"><rect width="100" height="100" fill="blue"/></svg>'),
    top: 50,
    left: 50
  }]).png().toBuffer();

  console.log('Chamando removeBackground...');
  const t0 = Date.now();
  const blob = await removeBackground(new Blob([inputBuffer], { type: 'image/png' }));
  const outBuf = Buffer.from(await blob.arrayBuffer());
  console.log('Remoção concluída com sucesso em', Date.now() - t0, 'ms! Bytes:', outBuf.length);
}

test().catch(err => {
  console.error('Falha no @imgly:', err);
});
