#include "VoiceManager.h"

VoiceManager& VoiceManager::instance() {
    static VoiceManager inst;
    return inst;
}

int64_t VoiceManager::join(int64_t userId, int64_t channelId) {
    std::lock_guard<std::mutex> lock(m_);
    int64_t prev = 0;
    auto it = userCh_.find(userId);
    if (it != userCh_.end()) {
        prev = it->second;
        auto cit = chUsers_.find(prev);
        if (cit != chUsers_.end()) {
            cit->second.erase(userId);
            if (cit->second.empty()) chUsers_.erase(cit);
        }
    }
    userCh_[userId] = channelId;
    chUsers_[channelId].insert(userId);
    return prev;
}

int64_t VoiceManager::leave(int64_t userId) {
    std::lock_guard<std::mutex> lock(m_);
    auto it = userCh_.find(userId);
    if (it == userCh_.end()) return 0;
    int64_t ch = it->second;
    auto cit = chUsers_.find(ch);
    if (cit != chUsers_.end()) {
        cit->second.erase(userId);
        if (cit->second.empty()) chUsers_.erase(cit);
    }
    userCh_.erase(it);
    return ch;
}

std::vector<int64_t> VoiceManager::usersIn(int64_t channelId) {
    std::lock_guard<std::mutex> lock(m_);
    std::vector<int64_t> out;
    auto it = chUsers_.find(channelId);
    if (it != chUsers_.end())
        out.assign(it->second.begin(), it->second.end());
    return out;
}

int64_t VoiceManager::channelOf(int64_t userId) {
    std::lock_guard<std::mutex> lock(m_);
    auto it = userCh_.find(userId);
    return it != userCh_.end() ? it->second : 0;
}
