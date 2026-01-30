// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

/**
 * @title MockVRFCoordinatorV2Plus
 * @dev Mock VRF Coordinator for testing CardPack contract
 * @notice Allows manual fulfillment of random words requests
 */
contract MockVRFCoordinatorV2Plus {
    uint256 private _requestId;

    mapping(uint256 => address) public requestToConsumer;
    mapping(uint256 => uint32) public requestToNumWords;

    event RandomWordsRequested(
        bytes32 indexed keyHash,
        uint256 requestId,
        uint256 preSeed,
        uint256 indexed subId,
        uint16 minimumRequestConfirmations,
        uint32 callbackGasLimit,
        uint32 numWords,
        bytes extraArgs,
        address indexed sender
    );

    event RandomWordsFulfilled(
        uint256 indexed requestId,
        uint256 outputSeed,
        uint96 payment,
        bool success
    );

    /**
     * @notice Request random words (called by CardPack)
     * @param req The VRF request parameters
     * @return requestId The request ID
     */
    function requestRandomWords(
        VRFV2PlusClient.RandomWordsRequest calldata req
    ) external returns (uint256) {
        uint256 requestId = ++_requestId;

        requestToConsumer[requestId] = msg.sender;
        requestToNumWords[requestId] = req.numWords;

        emit RandomWordsRequested(
            req.keyHash,
            requestId,
            0, // preSeed
            req.subId,
            req.requestConfirmations,
            req.callbackGasLimit,
            req.numWords,
            req.extraArgs,
            msg.sender
        );

        return requestId;
    }

    /**
     * @notice Fulfill random words request (for testing)
     * @param requestId The request ID to fulfill
     * @param consumer The consumer contract address
     * @param randomWords Array of random words to fulfill with
     */
    function fulfillRandomWords(
        uint256 requestId,
        address consumer,
        uint256[] calldata randomWords
    ) external {
        require(requestToConsumer[requestId] == consumer, "Invalid consumer");
        require(randomWords.length == requestToNumWords[requestId], "Wrong number of words");

        // Call the consumer's rawFulfillRandomWords function
        (bool success, ) = consumer.call(
            abi.encodeWithSignature(
                "rawFulfillRandomWords(uint256,uint256[])",
                requestId,
                randomWords
            )
        );

        emit RandomWordsFulfilled(requestId, 0, 0, success);

        require(success, "Fulfillment failed");
    }

    /**
     * @notice Fulfill with auto-generated random words (for convenience)
     * @param requestId The request ID to fulfill
     * @param seed A seed value to generate random words from
     */
    function fulfillRandomWordsWithSeed(
        uint256 requestId,
        uint256 seed
    ) external {
        address consumer = requestToConsumer[requestId];
        require(consumer != address(0), "Request not found");

        uint32 numWords = requestToNumWords[requestId];
        uint256[] memory randomWords = new uint256[](numWords);

        for (uint32 i = 0; i < numWords; i++) {
            randomWords[i] = uint256(keccak256(abi.encode(seed, requestId, i)));
        }

        (bool success, ) = consumer.call(
            abi.encodeWithSignature(
                "rawFulfillRandomWords(uint256,uint256[])",
                requestId,
                randomWords
            )
        );

        emit RandomWordsFulfilled(requestId, seed, 0, success);

        require(success, "Fulfillment failed");
    }

    /**
     * @notice Get current request ID counter
     * @return Current request ID
     */
    function getCurrentRequestId() external view returns (uint256) {
        return _requestId;
    }

    /**
     * @notice Get request details
     * @param requestId The request ID to query
     * @return consumer The consumer address
     * @return numWords The number of words requested
     */
    function getRequest(uint256 requestId)
        external
        view
        returns (address consumer, uint32 numWords)
    {
        return (requestToConsumer[requestId], requestToNumWords[requestId]);
    }
}
