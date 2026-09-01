#include "CryptoEngine.h"
#include <QRandomGenerator>

QByteArray CryptoEngine::encrypt(const QByteArray& data, const QByteArray& key) {
    if (key.isEmpty()) return data;
    QByteArray result(data.size(), 0);
    for (int i = 0; i < data.size(); ++i)
        result[i] = data[i] ^ key[i % key.size()];
    return result;
}

QByteArray CryptoEngine::decrypt(const QByteArray& data, const QByteArray& key) {
    return encrypt(data, key); // XOR is its own inverse
}

QByteArray CryptoEngine::generateKey(int length) {
    QByteArray key(length, 0);
    for (int i = 0; i < length; ++i)
        key[i] = static_cast<char>(QRandomGenerator::global()->bounded(256));
    return key;
}

QString CryptoEngine::toBase64(const QByteArray& data) {
    return QString::fromLatin1(data.toBase64());
}

QByteArray CryptoEngine::fromBase64(const QString& data) {
    return QByteArray::fromBase64(data.toLatin1());
}
