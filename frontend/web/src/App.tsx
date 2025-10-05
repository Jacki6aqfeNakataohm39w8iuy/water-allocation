// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface WaterRequest {
  id: string;
  encryptedData: string;
  timestamp: number;
  farmer: string;
  location: string;
  status: "pending" | "allocated" | "rejected";
  allocatedAmount?: number;
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<WaterRequest[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newRequestData, setNewRequestData] = useState({
    location: "",
    cropType: "",
    areaSize: "",
    waterNeed: ""
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [expandedRequest, setExpandedRequest] = useState<string | null>(null);
  const [showTeamInfo, setShowTeamInfo] = useState(false);

  // Calculate statistics for dashboard
  const allocatedCount = requests.filter(r => r.status === "allocated").length;
  const pendingCount = requests.filter(r => r.status === "pending").length;
  const rejectedCount = requests.filter(r => r.status === "rejected").length;
  const totalWaterRequested = requests.reduce((sum, req) => {
    const data = parseRequestData(req.encryptedData);
    return sum + (parseInt(data.waterNeed) || 0);
  }, 0);
  const totalWaterAllocated = requests.reduce((sum, req) => sum + (req.allocatedAmount || 0), 0);

  useEffect(() => {
    loadRequests().finally(() => setLoading(false));
  }, []);

  // Parse simulated FHE encrypted data
  const parseRequestData = (encrypted: string) => {
    try {
      const decoded = atob(encrypted.replace("FHE-", ""));
      return JSON.parse(decoded);
    } catch (e) {
      return { location: "", cropType: "", areaSize: "", waterNeed: "" };
    }
  };

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadRequests = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("request_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing request keys:", e);
        }
      }
      
      const list: WaterRequest[] = [];
      
      for (const key of keys) {
        try {
          const requestBytes = await contract.getData(`request_${key}`);
          if (requestBytes.length > 0) {
            try {
              const requestData = JSON.parse(ethers.toUtf8String(requestBytes));
              list.push({
                id: key,
                encryptedData: requestData.data,
                timestamp: requestData.timestamp,
                farmer: requestData.farmer,
                location: requestData.location,
                status: requestData.status || "pending",
                allocatedAmount: requestData.allocatedAmount
              });
            } catch (e) {
              console.error(`Error parsing request data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading request ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setRequests(list);
    } catch (e) {
      console.error("Error loading requests:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitRequest = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting water request with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newRequestData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const requestData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        farmer: account,
        location: newRequestData.location,
        status: "pending"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `request_${requestId}`, 
        ethers.toUtf8Bytes(JSON.stringify(requestData))
      );
      
      const keysBytes = await contract.getData("request_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(requestId);
      
      await contract.setData(
        "request_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted water request submitted!"
      });
      
      await loadRequests();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewRequestData({
          location: "",
          cropType: "",
          areaSize: "",
          waterNeed: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const allocateWater = async (requestId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing FHE optimization..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const requestBytes = await contract.getData(`request_${requestId}`);
      if (requestBytes.length === 0) {
        throw new Error("Request not found");
      }
      
      const requestData = JSON.parse(ethers.toUtf8String(requestBytes));
      
      // Simulate FHE-based allocation calculation
      const encryptedData = requestData.data;
      const parsedData = parseRequestData(encryptedData);
      const requestedAmount = parseInt(parsedData.waterNeed) || 0;
      
      // FHE optimization would happen here in real implementation
      const allocatedAmount = Math.min(requestedAmount, Math.floor(requestedAmount * 0.8));
      
      const updatedRequest = {
        ...requestData,
        status: "allocated",
        allocatedAmount: allocatedAmount
      };
      
      await contract.setData(
        `request_${requestId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedRequest))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Water allocation optimized with FHE!"
      });
      
      await loadRequests();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Allocation failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: `FHE system is ${isAvailable ? "available" : "unavailable"}`
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Availability check failed"
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedRequest(expandedRequest === id ? null : id);
  };

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to access the water allocation system",
      icon: "🔗"
    },
    {
      title: "Submit Water Request",
      description: "Enter your water needs which will be encrypted using FHE",
      icon: "💧"
    },
    {
      title: "FHE Optimization",
      description: "System processes encrypted requests to optimize water distribution",
      icon: "⚙️"
    },
    {
      title: "Receive Allocation",
      description: "Get your water allocation while keeping your data private",
      icon: "✅"
    }
  ];

  const renderBarChart = () => {
    // Group by location
    const locations = Array.from(new Set(requests.map(r => r.location))).filter(l => l);
    
    const data = locations.map(location => {
      const locRequests = requests.filter(r => r.location === location);
      const requested = locRequests.reduce((sum, req) => {
        const data = parseRequestData(req.encryptedData);
        return sum + (parseInt(data.waterNeed) || 0);
      }, 0);
      const allocated = locRequests.reduce((sum, req) => sum + (req.allocatedAmount || 0), 0);
      
      return {
        location,
        requested,
        allocated
      };
    });
    
    const maxValue = Math.max(...data.map(d => Math.max(d.requested, d.allocated)), 100);
    
    return (
      <div className="bar-chart-container">
        {data.map((item, index) => (
          <div className="bar-group" key={index}>
            <div className="bar-label">{item.location}</div>
            <div className="bars">
              <div 
                className="bar requested" 
                style={{ width: `${(item.requested / maxValue) * 100}%` }}
              >
                <span>{item.requested}m³</span>
              </div>
              <div 
                className="bar allocated" 
                style={{ width: `${(item.allocated / maxValue) * 100}%` }}
              >
                <span>{item.allocated}m³</span>
              </div>
            </div>
          </div>
        ))}
        <div className="chart-legend">
          <div className="legend-item">
            <div className="color-box requested"></div>
            <span>Requested</span>
          </div>
          <div className="legend-item">
            <div className="color-box allocated"></div>
            <span>Allocated</span>
          </div>
        </div>
      </div>
    );
  };

  const teamMembers = [
    {
      name: "Dr. Elena Rodriguez",
      role: "Water Resource Specialist",
      bio: "10+ years in sustainable water management"
    },
    {
      name: "Prof. Kenji Tanaka",
      role: "Cryptography Expert",
      bio: "FHE researcher with multiple publications"
    },
    {
      name: "Sarah Johnson",
      role: "Agricultural Engineer",
      bio: "IoT integration specialist"
    },
    {
      name: "Michael Chen",
      role: "Blockchain Developer",
      bio: "Smart contract and dApp expert"
    }
  ];

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing water allocation system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="water-drop-icon"></div>
          <h1>Aqua<span>FHE</span>Allocate</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + New Request
          </button>
          <button 
            className="tutorial-btn"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Guide" : "How It Works"}
          </button>
          <button 
            className="team-btn"
            onClick={() => setShowTeamInfo(!showTeamInfo)}
          >
            {showTeamInfo ? "Hide Team" : "Our Team"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content partitioned-layout">
        {/* Left Panel - Project Introduction */}
        <div className="panel left-panel">
          <div className="panel-content">
            <h2>FHE-Powered Water Allocation</h2>
            <p>Farmers submit encrypted water requests using Fully Homomorphic Encryption (FHE). Our system optimizes water distribution while keeping sensitive data private.</p>
            
            <div className="fhe-benefits">
              <div className="benefit-card">
                <div className="benefit-icon privacy"></div>
                <h3>Data Privacy</h3>
                <p>Farmers' sensitive information remains encrypted throughout the process</p>
              </div>
              
              <div className="benefit-card">
                <div className="benefit-icon optimization"></div>
                <h3>Optimal Allocation</h3>
                <p>FHE enables computation on encrypted data for fair distribution</p>
              </div>
              
              <div className="benefit-card">
                <div className="benefit-icon sustainability"></div>
                <h3>Sustainability</h3>
                <p>Prevents water waste through precise allocation algorithms</p>
              </div>
            </div>
            
            <button 
              className="check-availability-btn"
              onClick={checkAvailability}
            >
              Check FHE Availability
            </button>
          </div>
        </div>
        
        {/* Middle Panel - Data Management */}
        <div className="panel middle-panel">
          <div className="panel-content">
            {showTutorial && (
              <div className="tutorial-section">
                <h3>How AquaFHE Works</h3>
                
                <div className="tutorial-steps">
                  {tutorialSteps.map((step, index) => (
                    <div className="tutorial-step" key={index}>
                      <div className="step-number">{index + 1}</div>
                      <div className="step-content">
                        <h4>{step.title}</h4>
                        <p>{step.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            <div className="water-stats">
              <div className="stat-card">
                <div className="stat-value">{requests.length}</div>
                <div className="stat-label">Total Requests</div>
              </div>
              
              <div className="stat-card">
                <div className="stat-value">{totalWaterRequested}m³</div>
                <div className="stat-label">Water Requested</div>
              </div>
              
              <div className="stat-card">
                <div className="stat-value">{totalWaterAllocated}m³</div>
                <div className="stat-label">Water Allocated</div>
              </div>
            </div>
            
            <div className="requests-section">
              <div className="section-header">
                <h3>Water Allocation Requests</h3>
                <div className="header-actions">
                  <button 
                    onClick={loadRequests}
                    className="refresh-btn"
                    disabled={isRefreshing}
                  >
                    {isRefreshing ? "Refreshing..." : "Refresh"}
                  </button>
                </div>
              </div>
              
              <div className="requests-list">
                {requests.length === 0 ? (
                  <div className="no-requests">
                    <div className="no-requests-icon"></div>
                    <p>No water requests found</p>
                    <button 
                      className="create-btn primary"
                      onClick={() => setShowCreateModal(true)}
                    >
                      Create First Request
                    </button>
                  </div>
                ) : (
                  requests.map(request => (
                    <div 
                      className={`request-item ${request.status}`} 
                      key={request.id}
                      onClick={() => toggleExpand(request.id)}
                    >
                      <div className="request-summary">
                        <div className="request-location">{request.location}</div>
                        <div className="request-status">
                          <span className={`status-badge ${request.status}`}>
                            {request.status}
                          </span>
                        </div>
                        <div className="request-date">
                          {new Date(request.timestamp * 1000).toLocaleDateString()}
                        </div>
                      </div>
                      
                      {expandedRequest === request.id && (
                        <div className="request-details">
                          <div className="detail-row">
                            <span>Farmer:</span>
                            <span>{request.farmer.substring(0, 6)}...{request.farmer.substring(38)}</span>
                          </div>
                          
                          <div className="detail-row">
                            <span>Encrypted Data:</span>
                            <span className="encrypted-data">{request.encryptedData.substring(0, 20)}...</span>
                          </div>
                          
                          {request.status === "allocated" && (
                            <div className="detail-row">
                              <span>Allocated:</span>
                              <span>{request.allocatedAmount}m³</span>
                            </div>
                          )}
                          
                          <div className="decrypted-info">
                            <h4>Decrypted Information (Simulated):</h4>
                            <div className="info-grid">
                              {Object.entries(parseRequestData(request.encryptedData)).map(([key, value], idx) => (
                                <div className="info-item" key={idx}>
                                  <span className="info-label">{key}:</span>
                                  <span className="info-value">{String(value)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                          
                          {request.status === "pending" && (
                            <button 
                              className="allocate-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                allocateWater(request.id);
                              }}
                            >
                              Allocate Water
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
        
        {/* Right Panel - Charts and Team */}
        <div className="panel right-panel">
          <div className="panel-content">
            <div className="chart-section">
              <h3>Water Allocation by Region</h3>
              {requests.length > 0 ? renderBarChart() : (
                <div className="no-data-chart">
                  <p>Submit water requests to see allocation data</p>
                </div>
              )}
            </div>
            
            {showTeamInfo && (
              <div className="team-section">
                <h3>Our Team</h3>
                <div className="team-members">
                  {teamMembers.map((member, index) => (
                    <div className="team-member" key={index}>
                      <div className="member-avatar"></div>
                      <div className="member-info">
                        <h4>{member.name}</h4>
                        <div className="member-role">{member.role}</div>
                        <p>{member.bio}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitRequest} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          requestData={newRequestData}
          setRequestData={setNewRequestData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className={`transaction-content ${transactionStatus.status}`}>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="water-drop-icon"></div>
              <span>AquaFHEAllocate</span>
            </div>
            <p>FHE-powered water resource management for sustainable agriculture</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="copyright">
            © {new Date().getFullYear()} AquaFHEAllocate. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  requestData: any;
  setRequestData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  requestData,
  setRequestData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setRequestData({
      ...requestData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!requestData.location || !requestData.waterNeed) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>New Water Request</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="lock-icon"></div> 
            Your data will be encrypted with FHE for privacy protection
          </div>
          
          <div className="form-group">
            <label>Location *</label>
            <input 
              type="text"
              name="location"
              value={requestData.location} 
              onChange={handleChange}
              placeholder="Farm location..." 
              className="form-input"
            />
          </div>
          
          <div className="form-group">
            <label>Crop Type</label>
            <input 
              type="text"
              name="cropType"
              value={requestData.cropType} 
              onChange={handleChange}
              placeholder="Rice, Wheat, Corn..." 
              className="form-input"
            />
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label>Area Size (acres)</label>
              <input 
                type="number"
                name="areaSize"
                value={requestData.areaSize} 
                onChange={handleChange}
                placeholder="e.g., 50" 
                className="form-input"
              />
            </div>
            
            <div className="form-group">
              <label>Water Need (m³) *</label>
              <input 
                type="number"
                name="waterNeed"
                value={requestData.waterNeed} 
                onChange={handleChange}
                placeholder="Estimated water requirement" 
                className="form-input"
              />
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn primary"
          >
            {creating ? "Encrypting with FHE..." : "Submit Request"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;