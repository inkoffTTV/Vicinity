#include <drogon/drogon.h>
#include "models/Database.h"

int main() {
    drogon::app()
        .loadConfigFile("config.json")
        .registerBeginningAdvice([]() {
            Database::initialize();
        })
        .run();
    return 0;
}
