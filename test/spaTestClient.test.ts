import { SpaTestClient } from './spaTestClient';

describe('spaTest', () => {

  describe('spaTest', () => {
    test('spaTest', async () => {



      const spaTestClient = new SpaTestClient( "spa-240AC4EC20DC.local.", true);

      await sleep(60000);

    }, 60000);


  });


});

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
