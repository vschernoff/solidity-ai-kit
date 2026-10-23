/* global describe, it, ethers -- injected by the Hardhat test runner */
// Not run by the harness (it would need `npm install`); here so the layout is realistic.
const { expect } = require('chai')

describe('Wallet', function () {
  it('sets the deployer as owner', async function () {
    const [deployer] = await ethers.getSigners()
    const wallet = await ethers.deployContract('Wallet')
    expect(await wallet.owner()).to.equal(deployer.address)
  })
})
