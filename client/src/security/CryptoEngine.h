#pragma once
#include <QByteArray>
#include <QString>

class CryptoEngine {
public:
    // XOR-based symmetric encryption for local storage
    static QByteArray encrypt(const QByteArray& data, const QByteArray& key);
    static QByteArray decrypt(const QByteArray& data, const QByteArray& key);

    static QByteArray generateKey(int length = 32);
    static QString    toBase64(const QByteArray& data);
    static QByteArray fromBase64(const QString& data);
};
