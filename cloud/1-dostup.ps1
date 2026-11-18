# Мизансцена в облаке, шаг 1: права для сервера.
# Служебный аккаунт mizanscena-sa — это «сервер Мизансцены». Ему нужны два права в каталоге mizanscena:
#   ydb.editor     — читать и записывать проекты в базе данных mizanscena-db;
#   storage.editor — класть и читать файлы (фото, раскадровки) в хранилище mizanscena-files-5e230d29.
# Других прав у него нет: ни к платежам, ни к другим каталогам он доступа не получает.

$yc = 'C:\Users\user\yandex-cloud\bin\yc.exe'
$folder = 'b1g1i1chsb9qvsj72op3'          # каталог mizanscena
$sa = 'serviceAccount:ajer4cas7e6c2n4srgif' # служебный аккаунт mizanscena-sa

& $yc resource-manager folder add-access-binding --id $folder --role ydb.editor --subject $sa
& $yc resource-manager folder add-access-binding --id $folder --role storage.editor --subject $sa
Write-Host ''
Write-Host 'Готово. Права аккаунта mizanscena-sa:'
& $yc resource-manager folder list-access-bindings --id $folder
