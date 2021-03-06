const {
    BigNumber,
    utils: { keccak256, defaultAbiCoder, toUtf8Bytes, solidityPack },
} = require("ethers")
const { ecsign } = require("ethereumjs-util")
const { deployments, ethers } = require("hardhat")
const { BN } = require("bn.js")

const ADDRESS_ZERO = "0x0000000000000000000000000000000000000000"

const BASE_TEN = 10

const contracts = {}

function roundBN(number) {
    return new BN(number.toString()).divRound(new BN("10000000000000000")).toString()
}

function encodePrice(reserve0, reserve1) {
    return [
        reserve1.mul(BigNumber.from(2).pow(BigNumber.from(112))).div(reserve0),
        reserve0.mul(BigNumber.from(2).pow(BigNumber.from(112))).div(reserve1),
    ]
}

const PERMIT_TYPEHASH = keccak256(toUtf8Bytes("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"))

function getDomainSeparator(tokenAddress, chainId) {
    return keccak256(
        defaultAbiCoder.encode(
            ["bytes32", "uint256", "address"],
            [keccak256(toUtf8Bytes("EIP712Domain(uint256 chainId,address verifyingContract)")), chainId, tokenAddress]
        )
    )
}

function getApprovalDigest(token, approve, nonce, deadline, chainId = 1) {
    const DOMAIN_SEPARATOR = getDomainSeparator(token.address, chainId)
    const msg = defaultAbiCoder.encode(
        ["bytes32", "address", "address", "uint256", "uint256", "uint256"],
        [PERMIT_TYPEHASH, approve.owner, approve.spender, approve.value, nonce, deadline]
    )
    const pack = solidityPack(["bytes1", "bytes1", "bytes32", "bytes32"], ["0x19", "0x01", DOMAIN_SEPARATOR, keccak256(msg)])
    return keccak256(pack)
}

function getApprovalMsg(tokenAddress, approve, nonce, deadline) {
    const DOMAIN_SEPARATOR = getDomainSeparator(tokenAddress)
    const msg = defaultAbiCoder.encode(
        ["bytes32", "address", "address", "uint256", "uint256", "uint256"],
        [PERMIT_TYPEHASH, approve.owner, approve.spender, approve.value, nonce, deadline]
    )
    const pack = solidityPack(["bytes1", "bytes1", "bytes32", "bytes32"], ["0x19", "0x01", DOMAIN_SEPARATOR, keccak256(msg)])
    return pack
}

const BENTOBOX_MASTER_APPROVAL_TYPEHASH = keccak256(
    toUtf8Bytes("SetMasterContractApproval(string warning,address user,address masterContract,bool approved,uint256 nonce)")
)

function getBentoBoxDomainSeparator(address, chainId) {
    return keccak256(
        defaultAbiCoder.encode(
            ["bytes32", "string", "uint256", "address"],
            [keccak256(toUtf8Bytes("EIP712Domain(string name,uint256 chainId,address verifyingContract)")), "BentoBox V2", chainId, address]
        )
    )
}

function getBentoBoxApprovalDigest(bentoBox, user, masterContractAddress, approved, nonce, chainId = 1) {
    const DOMAIN_SEPARATOR = getBentoBoxDomainSeparator(bentoBox.address, chainId)
    const msg = defaultAbiCoder.encode(
        ["bytes32", "string", "address", "address", "bool", "uint256"],
        [
            BENTOBOX_MASTER_APPROVAL_TYPEHASH,
            approved ? "Give FULL access to funds in (and approved to) BentoBox?" : "Revoke access to BentoBox?",
            user.address,
            masterContractAddress,
            approved,
            nonce,
        ]
    )
    const pack = solidityPack(["bytes1", "bytes1", "bytes32", "bytes32"], ["0x19", "0x01", DOMAIN_SEPARATOR, keccak256(msg)])
    return keccak256(pack)
}

function getSignedMasterContractApprovalData(bentoBox, user, privateKey, masterContractAddress, approved, nonce) {
    const digest = getBentoBoxApprovalDigest(bentoBox, user, masterContractAddress, approved, nonce, user.provider._network.chainId)
    const { v, r, s } = ecsign(Buffer.from(digest.slice(2), "hex"), Buffer.from(privateKey.replace("0x", ""), "hex"))
    return { v, r, s }
}

async function setMasterContractApproval(bentoBox, from, user, privateKey, masterContractAddress, approved, fallback) {
    if (!fallback) {
        const nonce = await bentoBox.nonces(user.address)

        const digest = getBentoBoxApprovalDigest(bentoBox, user, masterContractAddress, approved, nonce, user.provider._network.chainId)
        const { v, r, s } = ecsign(Buffer.from(digest.slice(2), "hex"), Buffer.from(privateKey.replace("0x", ""), "hex"))

        return await bentoBox.connect(user).setMasterContractApproval(from.address, masterContractAddress, approved, v, r, s)
    }
    return await bentoBox
        .connect(user)
        .setMasterContractApproval(
            from.address,
            masterContractAddress,
            approved,
            0,
            "0x0000000000000000000000000000000000000000000000000000000000000000",
            "0x0000000000000000000000000000000000000000000000000000000000000000"
        )
}

async function setLendingPairContractApproval(bentoBox, user, privateKey, lendingPair, approved) {
    const nonce = await bentoBox.nonces(user.address)

    const digest = getBentoBoxApprovalDigest(bentoBox, user, lendingPair.address, approved, nonce, user.provider._network.chainId)
    const { v, r, s } = ecsign(Buffer.from(digest.slice(2), "hex"), Buffer.from(privateKey.replace("0x", ""), "hex"))

    return await lendingPair.connect(user).setApproval(user.address, approved, v, r, s)
}

async function lendingPairPermit(bentoBox, token, user, privateKey, lendingPair, amount) {
    const nonce = await token.nonces(user.address)

    const deadline = (await user.provider._internalBlockNumber).respTime + 10000

    const digest = await getApprovalDigest(
        token,
        {
            owner: user.address,
            spender: bentoBox.address,
            value: amount,
        },
        nonce,
        deadline,
        user.provider._network.chainId
    )
    const { v, r, s } = ecsign(Buffer.from(digest.slice(2), "hex"), Buffer.from(privateKey.replace("0x", ""), "hex"))

    return await lendingPair.connect(user).permitToken(token.address, user.address, bentoBox.address, amount, deadline, v, r, s)
}

function sansBorrowFee(amount) {
    return amount.mul(BigNumber.from(2000)).div(BigNumber.from(2001))
}

function sansSafetyAmount(amount) {
    return amount.sub(BigNumber.from(100000))
}

async function advanceTimeAndBlock(time, ethers) {
    await advanceTime(time, ethers)
    await advanceBlock(ethers)
}

async function advanceTime(time, ethers) {
    await ethers.provider.send("evm_increaseTime", [time])
}

async function advanceBlock(ethers) {
    await ethers.provider.send("evm_mine")
}

// Defaults to e18 using amount * 10^18
function getBigNumber(amount, decimals = 18) {
    return BigNumber.from(amount).mul(BigNumber.from(BASE_TEN).pow(decimals))
}

function addContract(thisObject, name, contract) {
    thisObject[name] = contract
    contract.thisName = name
    contracts[contract.address] = contract
}

async function getContract(thisObject, var_name, name) {
    const contract = await ethers.getContract(name)
    addContract(thisObject, var_name, contract)
    return contract
}

async function analyse(thisObject, tx_promise) {
    let tx
    try {
        tx = await tx_promise
    } catch (e) {
        const revertMsg = e.message.replace("VM Exception while processing transaction: revert ", "")
        if (revertMsg) {
            console.log('.to.be.revertedWith("' + revertMsg + '")')
        } else {
            console.log(".to.be.reverted")
        }
        return
    }
    const rx = await thisObject.alice.provider.getTransactionReceipt(tx.hash)
    const logs = decodeLogs(rx.logs)
    for (var i in logs) {
        var log = logs[i]
        console.log(".to.emit(this." + log.contract_name + ', "' + log.name + '")')
        console.log(".withArgs(" + log.args.join(", ") + ")")
    }
}

async function prepare(thisObject, contracts) {
    for (let i in contracts) {
        let contract = contracts[i]
        thisObject[contract] = await ethers.getContractFactory(contract)
        thisObject[contract].thisObject = thisObject
        thisObject[contract].new = async function (name, ...params) {
            let newContract = await thisObject[contract].deploy(...params)
            await newContract.deployed()
            addContract(thisObject, name, newContract)
            return newContract
        }
    }
    thisObject.signers = await ethers.getSigners()
    addContract(thisObject, "alice", thisObject.signers[0])
    addContract(thisObject, "bob", thisObject.signers[1])
    addContract(thisObject, "carol", thisObject.signers[2])
    addContract(thisObject, "dirk", thisObject.signers[3])
    addContract(thisObject, "erin", thisObject.signers[4])
    addContract(thisObject, "fred", thisObject.signers[5])
    thisObject.alicePrivateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
    thisObject.bobPrivateKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
    thisObject.carolPrivateKey = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
}

async function deploymentsFixture(thisObject, stepsFunction) {
    await deployments.fixture()
    await getContract(thisObject, "weth9", "WETH9Mock")
    await getContract(thisObject, "bentoBox", "BentoBoxMock")
    await getContract(thisObject, "factory", "SushiSwapFactoryMock")
    await getContract(thisObject, "lendingPair", "LendingPairMock")
    await getContract(thisObject, "peggedOracle", "PeggedOracle")
    await getContract(thisObject, "swapper", "SushiSwapSwapper")
    await getContract(thisObject, "oracle", "OracleMock")
    await getContract(thisObject, "helper", "BentoHelper")

    await stepsFunction({
        addToken: async function (var_name, name, symbol, decimals, tokenClass) {
            const token = await (tokenClass || thisObject.ReturnFalseERC20Mock).new(
                var_name,
                name,
                symbol,
                decimals,
                getBigNumber(1000000, decimals)
            )
            await token.transfer(thisObject.bob.address, getBigNumber(1000, decimals))
            await token.transfer(thisObject.carol.address, getBigNumber(1000, decimals))
            await token.transfer(thisObject.fred.address, getBigNumber(1000, decimals))
            return token
        },
        addPair: async function (var_name, tokenA, tokenB, amountA, amountB) {
            const createPairTx = await thisObject.factory.createPair(addr(tokenA), addr(tokenB))
            const pair = (await createPairTx.wait()).events[0].args.pair
            const SushiSwapPairMock = await ethers.getContractFactory("SushiSwapPairMock")
            const sushiSwapPair = await SushiSwapPairMock.attach(pair)
            addContract(thisObject, var_name, sushiSwapPair)

            await tokenA.transfer(sushiSwapPair.address, getBigNumber(amountA, await tokenA.decimals()))
            await tokenB.transfer(sushiSwapPair.address, getBigNumber(amountB, await tokenB.decimals()))

            await sushiSwapPair.mint(thisObject.alice.address)
            return sushiSwapPair
        },
    })

    global.expect2 = async function (tx_promise) {
        return await analyse(thisObject, tx_promise)
    }
}

async function deploy(thisObject, contracts) {
    for (let i in contracts) {
        let info = contracts[i]
        const contract = await info[1].deploy(...(info[2] || []))
        await contract.deployed()
        addContract(thisObject, info[0], contract)
    }
}

function decodeLogs(logs) {
    const decoded = []
    for (let i in logs) {
        const log = logs[i]
        let contract = contracts[log.address]
        if (contract) {
            let decodedLog = contract.interface.parseLog(log)
            const easyArgs = []
            for (var j in decodedLog.args) {
                if (!isNaN(j)) {
                    const arg = decodedLog.args[j]
                    //console.log(typeof arg, arg, arg.toString())
                    if (typeof arg == "string" && contracts[arg]) {
                        easyArgs.push("this." + contracts[arg].thisName + ".address")
                    } else {
                        easyArgs.push('"' + arg.toString() + '"')
                    }
                }
            }

            decoded.push({
                address: contract.address,
                name: decodedLog.name,
                args: easyArgs,
                contract: contract,
                contract_name: contract.thisName,
                raw: log,
                decoded: decodedLog,
            })
        } else {
            console.log("Cannot decode log")
        }
    }
    return decoded
}

function addr(address) {
    if (typeof address == "object" && address.address) {
        address = address.address
    }
    return address
}

module.exports = {
    ADDRESS_ZERO,
    addr,
    getDomainSeparator,
    getApprovalDigest,
    getApprovalMsg,
    getBentoBoxDomainSeparator,
    getBentoBoxApprovalDigest,
    lendingPairPermit,
    getSignedMasterContractApprovalData,
    setMasterContractApproval,
    setLendingPairContractApproval,
    sansBorrowFee,
    sansSafetyAmount,
    encodePrice,
    roundBN,
    advanceTime,
    advanceBlock,
    advanceTimeAndBlock,
    getBigNumber,
    prepare,
    deploymentsFixture,
    deploy,
    decodeLogs,
}
