// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract EncryptedWaterAllocator is SepoliaConfig {
    struct EncryptedRequest {
        uint256 id;
        euint32 encryptedDemand;
        euint32 encryptedPriority;
        uint256 timestamp;
    }

    struct DecryptedRequest {
        uint32 demand;
        uint32 priority;
        bool processed;
    }

    uint256 public requestCount;
    mapping(uint256 => EncryptedRequest) public encryptedRequests;
    mapping(uint256 => DecryptedRequest) public decryptedRequests;

    mapping(string => euint32) private encryptedAllocation;
    string[] private zoneList;

    mapping(uint256 => uint256) private requestToId;

    event RequestSubmitted(uint256 indexed id, uint256 timestamp);
    event DecryptionRequested(uint256 indexed id);
    event RequestDecrypted(uint256 indexed id);
    event AllocationUpdated(string zone, euint32 newValue);

    modifier onlyRequester(uint256 reqId) {
        _;
    }

    function submitEncryptedRequest(euint32 encryptedDemand, euint32 encryptedPriority) public {
        requestCount += 1;
        uint256 newId = requestCount;

        encryptedRequests[newId] = EncryptedRequest({
            id: newId,
            encryptedDemand: encryptedDemand,
            encryptedPriority: encryptedPriority,
            timestamp: block.timestamp
        });

        decryptedRequests[newId] = DecryptedRequest({
            demand: 0,
            priority: 0,
            processed: false
        });

        emit RequestSubmitted(newId, block.timestamp);
    }

    function requestDecryption(uint256 reqId) public onlyRequester(reqId) {
        EncryptedRequest storage req = encryptedRequests[reqId];
        require(!decryptedRequests[reqId].processed, "Already decrypted");

        bytes32[] memory ciphertexts = new bytes32[](2);
        ciphertexts[0] = FHE.toBytes32(req.encryptedDemand);
        ciphertexts[1] = FHE.toBytes32(req.encryptedPriority);

        uint256 decReqId = FHE.requestDecryption(ciphertexts, this.decryptRequest.selector);
        requestToId[decReqId] = reqId;

        emit DecryptionRequested(reqId);
    }

    function decryptRequest(uint256 decReqId, bytes memory cleartexts, bytes memory proof) public {
        uint256 reqId = requestToId[decReqId];
        require(reqId != 0, "Invalid request");

        EncryptedRequest storage eReq = encryptedRequests[reqId];
        DecryptedRequest storage dReq = decryptedRequests[reqId];
        require(!dReq.processed, "Already decrypted");

        FHE.checkSignatures(decReqId, cleartexts, proof);

        (uint32 demand, uint32 priority) = abi.decode(cleartexts, (uint32, uint32));

        dReq.demand = demand;
        dReq.priority = priority;
        dReq.processed = true;

        updateZoneAllocation("main_zone", euint32(demand));

        emit RequestDecrypted(reqId);
    }

    function updateZoneAllocation(string memory zone, euint32 additional) internal {
        if (!FHE.isInitialized(encryptedAllocation[zone])) {
            encryptedAllocation[zone] = FHE.asEuint32(0);
            zoneList.push(zone);
        }
        encryptedAllocation[zone] = FHE.add(encryptedAllocation[zone], additional);
        emit AllocationUpdated(zone, encryptedAllocation[zone]);
    }

    function getDecryptedRequest(uint256 reqId) public view returns (uint32 demand, uint32 priority, bool processed) {
        DecryptedRequest storage r = decryptedRequests[reqId];
        return (r.demand, r.priority, r.processed);
    }

    function getEncryptedAllocation(string memory zone) public view returns (euint32) {
        return encryptedAllocation[zone];
    }

    function requestAllocationDecryption(string memory zone) public {
        euint32 count = encryptedAllocation[zone];
        require(FHE.isInitialized(count), "Zone not found");

        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(count);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptAllocation.selector);
        requestToId[reqId] = bytes32ToUint(keccak256(abi.encodePacked(zone)));
    }

    function decryptAllocation(uint256 reqId, bytes memory cleartexts, bytes memory proof) public {
        uint256 zoneHash = requestToId[reqId];
        string memory zone = getZoneFromHash(zoneHash);

        FHE.checkSignatures(reqId, cleartexts, proof);

        uint32 value = abi.decode(cleartexts, (uint32));
    }

    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }

    function getZoneFromHash(uint256 hash) private view returns (string memory) {
        for (uint i = 0; i < zoneList.length; i++) {
            if (bytes32ToUint(keccak256(abi.encodePacked(zoneList[i]))) == hash) {
                return zoneList[i];
            }
        }
        revert("Zone not found");
    }
}
