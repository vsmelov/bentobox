// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "./IBentoBox.sol";

interface ISwapper {
    // Withdraws 'amountFrom' of token 'from' from the BentoBox account for this swapper
    // Swaps it for at least 'amountToMin' of token 'to'
    // Transfers the swapped tokens of 'to' into the BentoBox using a plain ERC20 transfer
    // Returns the amount of tokens 'to' transferred to BentoBox
    // (The BentoBox skim function will be used by the caller to get the swapped funds)
    function swap(
        IERC20 fromToken, IERC20 toToken, 
        address recipient, uint256 amountToMin, uint256 shareFrom
    ) external returns (uint256 extraAmount, uint256 shareTo);

    // Calculates the amount of token 'from' needed to complete the swap (amountFrom), this should be less than or equal to amountFromMax
    // Withdraws 'amountFrom' of token 'from' from the BentoBox account for this swapper
    // Swaps it for exactly 'exactAmountTo' of token 'to'
    // Transfers the swapped tokens of 'to' into the BentoBox using a plain ERC20 transfer
    // Transfers allocated, but unused 'from' tokens within the BentoBox to 'refundTo' (amountFromMax - amountFrom)
    // Returns the amount of 'from' tokens withdrawn from BentoBox (amountFrom)
    // (The BentoBox skim function will be used by the caller to get the swapped funds)
    function swapExact(
        IERC20 fromToken, 
        IERC20 toToken, 
        address recipient, 
        address refundTo, 
        uint256 shareFromSupplied, 
        uint256 shareToExact
    ) external returns (uint256 shareUsed, uint256 shareReturned);
}