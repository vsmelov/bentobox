module.exports = async function ({ ethers, getNamedAccounts, deployments }) {
  const { deploy } = deployments

  const { deployer } = await getNamedAccounts()

  const sushiSwapSwapper = await deployments.get("SushiSwapSwapper")

  const bentoBox = await deployments.get("BentoBoxMock")

  /*let response = await deploy("LendingPair", {
    from: deployer,
    args: [bentoBox.address],
    log: true,
    deterministicDeployment: false,
  })

  if (response.newlyDeployed) {
    const lendingPair = await ethers.getContract("LendingPair")
    lendingPair.setSwapper(sushiSwapSwapper.address, true)
  }*/

  response = await deploy("LendingPairMock", {
    from: deployer,
    args: [bentoBox.address],
    log: true,
    deterministicDeployment: false,
  })

  if (response.newlyDeployed) {
    const lendingPairMock = await ethers.getContract("LendingPairMock")
    lendingPairMock.setSwapper(sushiSwapSwapper.address, true)
  }
}

module.exports.dependencies = ["BentoBox", "SushiSwapSwapper", "Oracles"]
