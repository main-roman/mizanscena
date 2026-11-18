# Мизансцена в облаке, шаг 2: открыть сервер для программы.
# Функция mizanscena-api — это сервер. Чтобы программа на любом компьютере и телефоне могла к нему обращаться,
# вызывать функцию разрешается всем, у кого есть её адрес. Защиту делает сам сервер: без входа через Яндекс ID
# он ничего не отдаёт, а проекты показывает только их участникам.

$yc = 'C:\Users\user\yandex-cloud\bin\yc.exe'
& $yc serverless function allow-unauthenticated-invoke --name mizanscena-api --folder-id b1g1i1chsb9qvsj72op3
Write-Host ''
Write-Host 'Готово. Адрес сервера:'
& $yc serverless function get --name mizanscena-api --folder-id b1g1i1chsb9qvsj72op3 --format json | Select-String '"http_invoke_url"'
